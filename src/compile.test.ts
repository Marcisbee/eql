import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { Eql } from "./compile.ts";

const eql = new Eql();
const compileQuery = (q: string) => eql.compileQuery(q);
const compileMessage = (m: string) => eql.compileMessage(m);

describe("compileQuery - array arithmetic & broadcasting", () => {
  it("scalar + scalar", () => {
    const fn = compileQuery("1 + 2");
    expect(fn({})).toBe(3);
    expect(fn.toString()).toBe('f._arith("+", 1, 2)');
  });

  it("array + scalar broadcast", () => {
    const fn = compileQuery("[1,2,3] + 5");
    expect(fn({})).toEqual([6, 7, 8]);
    expect(fn.toString()).toBe('f._arith("+", [1, 2, 3], 5)');
  });

  it("scalar + array broadcast", () => {
    const fn = compileQuery("10 + [1,2]");
    expect(fn({})).toEqual([11, 12]);
    expect(fn.toString()).toBe('f._arith("+", 10, [1, 2])');
  });

  it("array + array same length element-wise", () => {
    const fn = compileQuery("[1,2] + [3,4]");
    expect(fn({})).toEqual([4, 6]);
    expect(fn.toString()).toBe('f._arith("+", [1, 2], [3, 4])');
  });

  it("array + array length mismatch => null", () => {
    const fn = compileQuery("[1,2] + [3]");
    expect(fn({})).toBeNull();
  });

  it("nested arithmetic with broadcast and precedence", () => {
    const fn = compileQuery("[1,2] * 2 + [3,4]");
    expect(fn({})).toEqual([5, 8]); // ([1,2]*2) => [2,4] + [3,4] => [5,8]
  });

  it("modulo with broadcast", () => {
    const fn = compileQuery("[5,10,12] % 5");
    expect(fn({})).toEqual([0, 0, 2]);
  });
});

describe("compileQuery - comparisons", () => {
  it("array > scalar broadcast", () => {
    const fn = compileQuery("[1,2,3] > 2");
    expect(fn({})).toEqual([false, false, true]);
    expect(fn.toString()).toBe('f._comp(">", [1, 2, 3], 2)');
  });

  it("array > array element-wise", () => {
    const fn = compileQuery("[1,2] > [2,1]");
    expect(fn({})).toEqual([false, true]);
  });

  it("array > array length mismatch => false", () => {
    const fn = compileQuery("[1,2] > [2]");
    expect(fn({})).toBe(false);
  });

  it("== deep equality element-wise", () => {
    const fn = compileQuery("[1,2,3] == [1,2,4]");
    expect(fn({})).toEqual([true, true, false]);
  });
});

describe("compileQuery - logical and not", () => {
  it("array and scalar broadcast", () => {
    const fn = compileQuery("[true,false,true] and false");
    expect(fn({})).toEqual([false, false, false]);
  });

  it("array and array element-wise", () => {
    const fn = compileQuery("[true,false] and [true,true]");
    expect(fn({})).toEqual([true, false]);
  });

  it("array and array length mismatch => false", () => {
    const fn = compileQuery("[true,false] and [true]");
    expect(fn({})).toBe(false);
  });

  it("not array element-wise", () => {
    const fn = compileQuery("not [true,false]");
    expect(fn({})).toEqual([false, true]);
    expect(fn.toString()).toBe("f._not([true, false])");
  });

  it("not scalar", () => {
    const fn = compileQuery("not true");
    expect(fn({})).toBe(false);
    expect(fn.toString()).toBe("f._not(true)");
  });
});

describe("compileQuery - string concatenation unchanged", () => {
  it("concatenates string & array (array JSON stringified)", () => {
    const fn = compileQuery('"x" & [1,2]');
    expect(fn({})).toBe("x[1,2]");
    expect(fn.toString()).toBe('f.concat("x", [1, 2])');
  });
});

describe("compileMessage - embeddings with array arithmetic", () => {
  it("embeds broadcast arithmetic result as JSON string", () => {
    const msg = compileMessage("Ages+1: { users | map(.age) + 1 }");
    const out = msg({
      users: [{ age: 2 }, { age: 5 }],
    });
    expect(out).toBe("Ages+1: [3,6]");
  });

  it("embeds comparison broadcasting", () => {
    const msg = compileMessage("{ [1,2,3] > 1 }");
    expect(msg({})).toBe("[false,true,true]");
  });

  it("multiple embeddings with text", () => {
    const msg = compileMessage(
      "Sum: { [1,2,3] + 1 } | Logic: { [true,false] and true }",
    );
    expect(msg({})).toBe("Sum: [2,3,4] | Logic: [true,false]");
  });
});

describe("compileQuery - complex mix", () => {
  it("pipeline then arithmetic broadcast", () => {
    const fn = compileQuery("numbers | map(.val) + 10");
    const res = fn({
      numbers: [{ val: 1 }, { val: 5 }, { val: -2 }],
    });
    expect(res).toEqual([11, 15, 8]);
  });

  it("comparison after pipeline", () => {
    const fn = compileQuery("numbers | map(.val) > 2");
    const res = fn({
      numbers: [{ val: 1 }, { val: 3 }, { val: 2 }],
    });
    expect(res).toEqual([false, true, false]);
  });

  it("logical broadcast with comparison result", () => {
    const fn = compileQuery("(numbers | map(.val) > 1) and true");
    const res = fn({
      numbers: [{ val: 0 }, { val: 2 }, { val: 5 }],
    });
    expect(res).toEqual([false, true, true]);
  });
});

describe("compileQuery - error resilience", () => {
  it("division by zero returns null / elements null", () => {
    const fn = compileQuery("[1,2] / 0");
    expect(fn({})).toEqual([null, null]);
  });

  it("array % 0 returns null elements", () => {
    const fn = compileQuery("[5,10] % 0");
    expect(fn({})).toEqual([null, null]);
  });

  it("invalid arithmetic operand yields null", () => {
    const fn = compileQuery('[1,2] + "x"');
    // scalar "x" => toNumber null => each element null
    expect(fn({})).toEqual([null, null]);
  });
});
