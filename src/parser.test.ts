import { describe, it } from "jsr:@std/testing/bdd";
import { expect } from "jsr:@std/expect";
import { parseMessage, parseQuery } from "./parser.ts";

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
