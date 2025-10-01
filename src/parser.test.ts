import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { parseMessage, parseQuery } from "./parser.ts";
import { generateQueryCode } from "./codegen.ts";

describe("basic literals and paths", () => {
  it("parses simple path", () => {
    const ast = parseQuery("users.0.name");
    expect(ast).toEqual({
      type: "Path",
      relative: 0,
      segments: [
        { kind: "prop", name: "users" },
        { kind: "index", index: 0 },
        { kind: "prop", name: "name" },
      ],
    });
  });

  it("parses simple number literal", () => {
    const ast = parseQuery("42");
    expect(ast).toEqual({ type: "NumberLiteral", value: 42 });
  });

  it("parses string literal with escape", () => {
    const ast = parseQuery('"hello \\"world\\""');
    expect(ast).toEqual({ type: "StringLiteral", value: 'hello "world"' });
  });
});

describe("parses", () => {
  for (
    const [input, output] of [
      ["foo", "i.foo"],
      ["a.b.c", "i.a.b.c"],
      ["a[1]", "i.a[1]"],
      ["a[b]", "i.a[i.b]"],
      ["a[b] | upper", "f.upper(i.a[i.b])"],
      ['a[b] | upper("1")', 'f.upper(i.a[i.b], "1")'],
      ["a[b] | filter(.b)", "f.filter(i.a[i.b], function(v0){return v0.b})"],
      ["null", "null"],
      ["true", "true"],
      ["false", "false"],
      ["nully", "i.nully"],
      ["truethy", "i.truethy"],
      ["falsey", "i.falsey"],
      ["true==false", 'f._comp("==", true, false)'],
      ["5", "5"],
      ["5.6", "5.6"],
      ["-5", "-5"],
      ["-5.6", "-5.6"],
      ["-0.25", "-0.25"],
      ["-5+2", 'f._arith("+", -5, 2)'],
      ['"hello"', '"hello"'],
      ["[1,3,6]", "[1, 3, 6]"],
      ["{a:2}", '({"a":2})'],
      ['{a:[],b:[1,"foo bar %",{}]}', '({"a":[], "b":[1, "foo bar %", ({})]})'],
      [
        '"hello_"&5&true&input.a.b',
        'f.concat(f.concat(f.concat("hello_", 5), true), i.input.a.b)',
      ],
      [
        "users | filter(.age > 18) | map(.name) | sort",
        'f.sort(f.map(f.filter(i.users, function(v0){return f._comp(">", v0.age, 18)}), function(v0){return v0.name}))',
      ],
      ["1+2", 'f._arith("+", 1, 2)'],
      [
        "1+2/7%(2*5.5+input.max)",
        'f._arith("+", 1, f._arith("%", f._arith("/", 2, 7), f._arith("+", f._arith("*", 2, 5.5), i.input.max)))',
      ],
    ] satisfies [string, string][]
  ) {
    it(JSON.stringify(input), () => {
      const ast = parseQuery(input);
      const generated = generateQueryCode(ast as any);

      expect(generated).toEqual(output);
    });
  }
});

describe("arrays, objects, ranges", () => {
  it("parses empty array", () => {
    const ast = parseQuery("[]");
    expect(ast).toEqual({ type: "ArrayLiteral", elements: [] });
  });

  it("parses array with literals and range", () => {
    const ast = parseQuery('[1, 2, 3..5, "x"]');
    expect(ast).toEqual({
      type: "ArrayLiteral",
      elements: [
        { type: "NumberLiteral", value: 1 },
        { type: "NumberLiteral", value: 2 },
        {
          type: "RangeLiteral",
          start: { type: "NumberLiteral", value: 3 },
          end: { type: "NumberLiteral", value: 5 },
        },
        { type: "StringLiteral", value: "x" },
      ],
    });
  });

  it("parses object literal", () => {
    const ast = parseQuery('{name: "Alice", age: 30}');
    expect(ast).toEqual({
      type: "ObjectLiteral",
      properties: [
        { key: "name", value: { type: "StringLiteral", value: "Alice" } },
        { key: "age", value: { type: "NumberLiteral", value: 30 } },
      ],
    });
  });
});

describe("functions and pipelines", () => {
  it("parses function call with args", () => {
    const ast = parseQuery('concat("a", "b", "c")');
    expect(ast).toEqual({
      type: "FunctionCall",
      name: "concat",
      args: [
        { type: "StringLiteral", value: "a" },
        { type: "StringLiteral", value: "b" },
        { type: "StringLiteral", value: "c" },
      ],
    });
  });

  it("parses pipeline with filter/map/sort", () => {
    const ast = parseQuery("users | filter(.age > 18) | map(.name) | sort");
    expect(ast.type).toBe("Pipeline");
    const pipeline = ast as any;
    expect(pipeline.stages.length).toBe(3);
    expect(pipeline.stages.map((s: any) => s.name)).toEqual([
      "filter",
      "map",
      "sort",
    ]);
  });

  it("parses pipeline inside arithmetic", () => {
    const ast = parseQuery("(numbers | filter(.value > 0) | sum) + 10");
    expect(ast.type).toBe("BinaryExpression");
    const bin = ast as any;
    expect(bin.operator).toBe("+");
    expect(bin.left.type).toBe("Pipeline");
    expect(bin.right).toEqual({ type: "NumberLiteral", value: 10 });
  });
});

describe("operators & precedence", () => {
  it("respects multiplicative over additive and additive chain left-assoc with &", () => {
    const ast = parseQuery('1 + 2 * 3 & "x"');
    // Expect ((1 + (2*3)) & "x")
    expect(ast).toEqual({
      type: "BinaryExpression",
      operator: "&",
      left: {
        type: "BinaryExpression",
        operator: "+",
        left: { type: "NumberLiteral", value: 1 },
        right: {
          type: "BinaryExpression",
          operator: "*",
          left: { type: "NumberLiteral", value: 2 },
          right: { type: "NumberLiteral", value: 3 },
        },
      },
      right: { type: "StringLiteral", value: "x" },
    });
  });

  it("parses comparison and logical precedence", () => {
    const ast = parseQuery("flagA or flagB and flagC");
    // Expect or at top, and groups right side
    expect(ast).toEqual({
      type: "BinaryExpression",
      operator: "or",
      left: {
        type: "Path",
        relative: 0,
        segments: [{ kind: "prop", name: "flagA" }],
      },
      right: {
        type: "BinaryExpression",
        operator: "and",
        left: {
          type: "Path",
          relative: 0,
          segments: [{ kind: "prop", name: "flagB" }],
        },
        right: {
          type: "Path",
          relative: 0,
          segments: [{ kind: "prop", name: "flagC" }],
        },
      },
    });
  });
});

describe("dynamic & relative paths", () => {
  it("parses dynamic bracket path", () => {
    const ast = parseQuery("users[input.idx].name");
    expect(ast).toEqual({
      type: "Path",
      relative: 0,
      segments: [
        { kind: "prop", name: "users" },
        {
          kind: "dynamic",
          expr: {
            type: "Path",
            relative: 0,
            segments: [
              { kind: "prop", name: "input" },
              { kind: "prop", name: "idx" },
            ],
          },
        },
        { kind: "prop", name: "name" },
      ],
    });
  });

  describe("edge cases", () => {
    it("parses pipeline with final function stage plus arithmetic", () => {
      const ast = parseQuery("data.values | sum + 1");
      const gen = generateQueryCode(ast as any);
      expect(gen).toEqual('f._arith("+", f.sum(i.data.values), 1)');
    });

    it("parses nested dynamic path expression", () => {
      const ast = parseQuery("items[input.min + 1].value");
      const gen = generateQueryCode(ast as any);
      expect(gen).toEqual('i.items[f._arith("+", i.input.min, 1)].value');
    });

    it("parses range inside array literal with expressions", () => {
      const ast = parseQuery("[0, a.b, 1..3]");
      expect(ast.type).toBe("ArrayLiteral");
      const gen = generateQueryCode(ast as any);
      expect(gen).toEqual("[0, i.a.b, f.range(1, 3)]");
    });

    it("handles not precedence vs additive", () => {
      const ast = parseQuery("not a + b");
      const gen = generateQueryCode(ast as any);
      expect(gen).toEqual('f._arith("+", f._not(i.a), i.b)');
    });

    it("deep relative path inside nested filters (syntactic only)", () => {
      const q = "users | filter(.friends | filter(..age > 18) | len > 0)";
      const ast = parseQuery(q);
      expect(ast.type).toBe("Pipeline");
    });
  });

  describe("negative / invalid syntax", () => {
    const invalidQueries = [
      "",
      "(",
      "users | filter(.age > 18",
      "a..b",
      '"unterminated',
      "users | | map(.x)",
      "1 + * 2",
      "func(1,,2)",
      "arr[",
      "{a:1,}",
    ];

    for (const iq of invalidQueries) {
      it(`fails to parse: ${JSON.stringify(iq)}`, () => {
        expect(() => parseQuery(iq)).toThrow();
      });
    }
  });

  describe("message mode edge/failure cases", () => {
    it("throws on unterminated embed", () => {
      expect(() => parseMessage("Hello { user.name")).toThrow();
    });

    it("parses empty embed as null literal expr producing no error", () => {
      const tpl = parseMessage("Value: {   }!");
      // Second part should be embed with NullLiteral
      const embed = tpl.parts.find((p) => p.kind === "embed") as any;
      expect(embed.expr).toEqual({ type: "NullLiteral" });
    });

    it("allows escaped braces alongside real embed", () => {
      const tpl = parseMessage("\\{ not expr } and real { a }");
      const textPart = tpl.parts[0];
      expect(textPart).toEqual({
        kind: "text",
        value: "{ not expr } and real ",
      });
      const embed = tpl.parts[1] as any;
      expect(embed.expr.type).toBe("Path");
    });
  });

  it("captures relative path depth in filter", () => {
    const ast = parseQuery("items | filter(.age >= ..minAge)");
    expect(ast.type).toBe("Pipeline");
    const pipeline = ast as any;
    const filterStage = pipeline.stages[0];
    expect(filterStage.name).toBe("filter");
    // Ensure relative path exists inside expression
    const relFound = JSON.stringify(filterStage.args[0]).includes(
      '"relative":2',
    );
    expect(relFound).toBe(true);
  });
});

describe("message mode", () => {
  it("parses template with embeddings and text", () => {
    const tpl = parseMessage(
      "Hello { user.name }! You have { notifications | len } new messages.",
    );
    expect(tpl).toEqual({
      type: "MessageTemplate",
      parts: [
        { kind: "text", value: "Hello " },
        {
          kind: "embed",
          expr: {
            type: "Path",
            relative: 0,
            segments: [
              { kind: "prop", name: "user" },
              { kind: "prop", name: "name" },
            ],
          },
        },
        { kind: "text", value: "! You have " },
        {
          kind: "embed",
          expr: {
            type: "Pipeline",
            input: {
              type: "Path",
              relative: 0,
              segments: [{ kind: "prop", name: "notifications" }],
            },
            stages: [
              { type: "PipeCall", name: "len", args: [] },
            ],
          },
        },
        { kind: "text", value: " new messages." },
      ],
    });
  });

  it("supports escape sequences", () => {
    const tpl = parseMessage(
      'Literal \\{ brace and backslash \\\\ plus { "ok" }',
    );
    expect(tpl.parts[0]).toEqual({
      kind: "text",
      value: "Literal { brace and backslash \\ plus ",
    });
    expect((tpl.parts[1] as any).expr).toEqual({
      type: "StringLiteral",
      value: "ok",
    });
  });
});
