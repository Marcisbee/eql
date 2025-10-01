import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";

import { parseQuery } from "./parser.ts";
import { generateQueryCode } from "./codegen.ts";
import { Eql } from "./compile.ts";

const eql = new Eql();
const compileQuery = (q: string) => eql.compileQuery(q);
const compileMessage = (m: string) => eql.compileMessage(m);

/**
 * Edge case & robustness tests.
 *
 * These focus on:
 *  - Broadcasting + mismatch behaviors
 *  - Null propagation through chained operations
 *  - Dynamic paths & ranges
 *  - Relative scope edge usage
 *  - Pipelines embedded in arithmetic
 *  - Message mode coercions & escapes
 *  - Division / modulo by zero inside mixed expressions
 */

describe("edge: arithmetic & broadcasting", () => {
  it("scalar + scalar basic", () => {
    const fn = compileQuery("1 + 2");
    expect(fn({})).toBe(3);
  });

  it("array + scalar broadcast", () => {
    const fn = compileQuery("[0,1,2] + 10");
    expect(fn({})).toEqual([10, 11, 12]);
  });

  it("scalar + array broadcast", () => {
    const fn = compileQuery("5 + [1,2,3]");
    expect(fn({})).toEqual([6, 7, 8]);
  });

  it("array + array same length", () => {
    const fn = compileQuery("[1,2,3] + [4,5,6]");
    expect(fn({})).toEqual([5, 7, 9]);
  });

  it("array + array length mismatch => null", () => {
    const fn = compileQuery("[1,2] + [3]");
    expect(fn({})).toBeNull();
  });

  it("comparison length mismatch => false", () => {
    const fn = compileQuery("[1,2] > [0]");
    expect(fn({})).toBe(false);
  });

  it("logical length mismatch => false", () => {
    const fn = compileQuery("[true,false] and [true]");
    expect(fn({})).toBe(false);
  });

  it("null propagation from first failed broadcast chain", () => {
    const fn = compileQuery("[1,2] + [1] + 5");
    // First addition => null, then null + 5 => null
    expect(fn({})).toBeNull();
  });

  it("element-wise division with zero => element nulls", () => {
    const fn = compileQuery("[5,10] / 0");
    expect(fn({})).toEqual([null, null]);
  });

  it("element-wise modulo with zero => element nulls", () => {
    const fn = compileQuery("[5,10] % 0");
    expect(fn({})).toEqual([null, null]);
  });

  it("chained mixed arithmetic precedence", () => {
    const fn = compileQuery("[1,2] * 2 + [3,4] * 2");
    // ([1,2]*2) => [2,4]; ([3,4]*2)=>[6,8]; [2,4]+[6,8] = [8,12]
    expect(fn({})).toEqual([8, 12]);
  });
});

describe("edge: pipelines inside arithmetic", () => {
  it("(pipeline) * scalar", () => {
    const fn = compileQuery("(nums | map(.val) | sum) * 2");
    const out = fn({ nums: [{ val: 1 }, { val: 4 }] });
    expect(out).toBe(10); // (1+4)*2
  });

  it("broadcast after pipeline: (map) + array", () => {
    const fn = compileQuery("(nums | map(.val)) + [1,2,3]");
    const out = fn({ nums: [{ val: 0 }, { val: 10 }, { val: -1 }] });
    expect(out).toEqual([1, 12, 2]);
  });

  it("comparison pipeline result > scalar", () => {
    const fn = compileQuery("(nums | filter(.v > 1) | len) > 2");
    expect(fn({
      nums: [{ v: 0 }, { v: 5 }, { v: 9 }, { v: 1 }],
    })).toBe(false); // two elements >1 (5,9) => len=2 => 2>2 false
  });

  it("(pipeline) and scalar logical broadcast (array result)", () => {
    const fn = compileQuery("(nums | map(.flag)) and true");
    const out = fn({
      nums: [{ flag: true }, { flag: false }, { flag: 1 }],
    });
    expect(out).toEqual([true, false, true]);
  });
});

describe("edge: ranges & objects", () => {
  it("range normal inclusive", () => {
    // Codegen wraps range literal inside an array literal element => [f.range(...)] => [ [1,2,3,4] ]
    // Current runtime returns the expanded array as a nested element.
    const fn = compileQuery("[1..4]");
    expect(fn({})).toEqual([[1, 2, 3, 4]]);
  });

  it("range start > end => []", () => {
    // Empty range still appears as single element inside outer array
    const fn = compileQuery("[5..2]");
    expect(fn({})).toEqual([[]]);
  });

  it("range non-integer => null", () => {
    const fn = compileQuery("[1.2..4]");
    // 1.2 not integer -> range helper returns null, embedded literal becomes [null]
    // Because codegen emits f.range(1.2, 4) inside array literal: [f.range(...)]
    // Implementation returns null for range => final array [null]
    const result = fn({});
    expect(result).toEqual([null]);
  });

  it("object with dynamic key path (concat inside)", () => {
    const fn = compileQuery('{score: user.data["score_" & input.idx]}');
    const out = fn({
      user: { data: { score_0: 42 } },
      input: { idx: 0 },
    });
    expect(out).toEqual({ score: 42 });
  });

  it("object combining pipeline result & scalar", () => {
    const fn = compileQuery('{count: items | len, tag: "ok"}');
    const out = fn({ items: [1, 2, 3] });
    expect(out).toEqual({ count: 3, tag: "ok" });
  });
});

describe("edge: dynamic paths", () => {
  it("index via expression arithmetic", () => {
    const fn = compileQuery("arr[min + 1]");
    const out = fn({ arr: ["a", "b", "c"], min: 0 });
    expect(out).toBe("b");
  });

  it("string key via concat", () => {
    const fn = compileQuery('obj["pre_" & suffix]');
    const out = fn({ obj: { pre_x: 7 }, suffix: "x" });
    expect(out).toBe(7);
  });

  it("index expression referencing path chain", () => {
    const fn = compileQuery("grid[row.index]");
    const out = fn({
      grid: [10, 20, 30],
      row: { index: 2 },
    });
    expect(out).toBe(30);
  });
});

describe("edge: relative scoping", () => {
  it("nested filter uses .. to climb", () => {
    const q =
      "users | filter(.friends | filter(..age > 18) | len > 0) | map(.name)";
    const fn = compileQuery(q);
    const out = fn({
      users: [
        { name: "A", age: 19, friends: [{ age: 10 }] },
        { name: "B", age: 17, friends: [{ age: 20 }] },
        { name: "C", age: 25, friends: [{ age: 30 }] },
      ],
    });
    expect(out).toEqual(["A", "C"]);
  });

  it("relative path beyond available scope yields undefined->null in arithmetic", () => {
    // Inside first map (.value refers to v0).
    // Inside the inner map we try ...value (three dots) but only one level -> undefined
    // undefined + 1 => null for that element; other remain fine if accessible.
    const q = "items | map(.values | map(...value + 1))";
    const fn = compileQuery(q);
    const out = fn({
      items: [{ values: [1, 2] }],
    });
    // Inner attempt resolves undefined for ...value -> f._arith -> null each element
    expect(out).toEqual([[null, null]]);
  });
});

describe("edge: message mode", () => {
  it("coerces null/undefined to empty string", () => {
    const msg = compileMessage("Values: { a }-{ b }.");
    const out = msg({ a: null });
    expect(out).toBe("Values: -.");
  });

  it("coerces boolean & number", () => {
    const msg = compileMessage("Flag { ok } Count { n }");
    const out = msg({ ok: false, n: 12 });
    expect(out).toBe("Flag false Count 12");
  });

  it("embeds broadcast result (array -> JSON string)", () => {
    const msg = compileMessage("Inc: { values + 1 }");
    const out = msg({ values: [1, 2] });
    expect(out).toBe("Inc: [2,3]");
  });

  it("escaped braces and backslash", () => {
    const msg = compileMessage('\\{ raw \\ text { "x" }');
    const out = msg({});
    expect(out).toBe("{ raw \\ text x");
  });

  it("empty embedding => empty string", () => {
    const msg = compileMessage("Start{   }End");
    const out = msg({});
    expect(out).toBe("StartEnd");
  });
});

describe("edge: parse + codegen consistency (spot checks)", () => {
  const samples: string[] = [
    "users | filter(.age > 18) | len",
    "(a + 1) * (b + 2)",
    "data.values | map(.score) + 1",
    "not flag and other",
    '"x_" & id & "_" & (n + 1)',
  ];

  for (const s of samples) {
    it(`codegen stability: ${s}`, () => {
      const ast = parseQuery(s);
      const code = generateQueryCode(ast as any);
      // Just ensure it emits a non-empty string referencing i./f.
      expect(code.length).toBeGreaterThan(0);
      expect(/i\./.test(code) || /i\[/.test(code)).toBe(true);
    });
  }
});

describe("edge: error propagation scenarios", () => {
  it("invalid operand inside chain causes null final", () => {
    const fn = compileQuery('(numbers | map(.val)) + "x" + 5');
    const out = fn({
      numbers: [{ val: 1 }, { val: 2 }],
    });
    // (array + "x") => element-wise null => null + 5 => null
    expect(out).toEqual([null, null]);
  });

  it("comparison on arrays after earlier null arithmetic stays null or coerces boolean logic separately", () => {
    const fn = compileQuery("(values + [1]) > 2");
    const out = fn({ values: [1, 2] }); // length mismatch => null from first -> null > 2 => false? (cmp scalar) -> but left is null -> treat as scalar null comparison
    // Behavior: _arith => null, then _comp('>', null, 2) => (null > 2) => false
    expect(out).toBe(false);
  });

  it("logical op after mismatch comparison", () => {
    const fn = compileQuery("([1,2] > [1]) and true");
    // [1,2] > [1] => false (length mismatch comp) => false and true => false
    expect(fn({})).toBe(false);
  });
});
