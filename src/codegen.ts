/**
 * Unified EQL code generator (extended semantics).
 *
 * Responsibilities:
 *  - Convert parsed AST (from parser.ts) into JavaScript source strings
 *    referencing runtime helpers `f.*`.
 *  - Apply element-wise / broadcast semantics for arithmetic, comparison,
 *    logical, and unary not operations using helper calls:
 *      f._arith(op, a, b)
 *      f._comp(op, a, b)
 *      f._logic(op, a, b)
 *      f._not(x)
 *  - Keep other constructs (paths, literals, arrays, objects, functions,
 *    pipelines, ranges, concat) straightforward.
 *
 * This module is intentionally decoupled from the parser so the parser
 * only produces AST and never generates code.
 */

/* ============================================================
 * AST Type Mirrors (align with parser.ts)
 * ============================================================ */

export type NumberLiteral = { type: "NumberLiteral"; value: number };
export type StringLiteral = { type: "StringLiteral"; value: string };
export type BooleanLiteral = { type: "BooleanLiteral"; value: boolean };
export type NullLiteral = { type: "NullLiteral" };

export type RangeLiteral = {
  type: "RangeLiteral";
  start: Expression;
  end: Expression;
};

export type ArrayLiteral = {
  type: "ArrayLiteral";
  elements: (Expression | RangeLiteral)[];
};

export type ObjectProperty = {
  key: string;
  value: Expression;
};

export type ObjectLiteral = {
  type: "ObjectLiteral";
  properties: ObjectProperty[];
};

export type PathPropSegment = { kind: "prop"; name: string };
export type PathIndexSegment = { kind: "index"; index: number };
export type PathDynamicSegment = { kind: "dynamic"; expr: Expression };
export type PathSegment =
  | PathPropSegment
  | PathIndexSegment
  | PathDynamicSegment;

export type PathExpression = {
  type: "Path";
  relative: number; // 0 = root, >0 = relative (., .., etc.)
  segments: PathSegment[];
};

export type FunctionCall = {
  type: "FunctionCall";
  name: string;
  args: Expression[];
};

export type UnaryExpression = {
  type: "UnaryExpression";
  operator: string; // 'not'
  argument: Expression;
};

export type BinaryExpression = {
  type: "BinaryExpression";
  operator: string; // + - * / % & == != > < >= <= and or
  left: Expression;
  right: Expression;
};

export type PipeStage = {
  name: string;
  args: Expression[];
};

export type PipelineExpression = {
  type: "Pipeline";
  input: Expression;
  stages: PipeStage[];
};

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | RangeLiteral
  | ArrayLiteral
  | ObjectLiteral
  | PathExpression
  | FunctionCall
  | UnaryExpression
  | BinaryExpression
  | PipelineExpression;

export type TemplateTextPart = { kind: "text"; value: string };
export type TemplateEmbedPart = { kind: "embed"; expr: Expression };
export type MessageTemplate = {
  type: "MessageTemplate";
  parts: (TemplateTextPart | TemplateEmbedPart)[];
};

/* ============================================================
 * Internal Codegen Context
 * ============================================================ */

type CodeGenContext = {
  scopes: string[]; // iter variables stack for nested filter/map
};

/**
 * Generate next iteration variable name.
 */
function nextIterVar(depth: number): string {
  return `v${depth}`;
}

/* ============================================================
 * Core Generators
 * ============================================================ */

/**
 * Generate code for a full query expression.
 */
export function generateQueryCode(ast: Expression): string {
  return genExpr(ast, { scopes: [] });
}

/**
 * Generate message parts (code for embeds, literal for text).
 */
export function generateMessageParts(
  tpl: MessageTemplate,
): { code: string; isExpr: boolean }[] {
  return tpl.parts.map((p) => {
    if (p.kind === "text") {
      return { code: JSON.stringify(p.value), isExpr: false };
    }
    return { code: genExpr(p.expr, { scopes: [] }), isExpr: true };
  });
}

/**
 * Dispatch expression node handler.
 */
function genExpr(node: Expression, ctx: CodeGenContext): string {
  switch (node.type) {
    case "NumberLiteral":
      return String(node.value);
    case "StringLiteral":
      return JSON.stringify(node.value);
    case "BooleanLiteral":
      return node.value ? "true" : "false";
    case "NullLiteral":
      return "null";
    case "Path":
      return genPath(node, ctx);
    case "RangeLiteral":
      return genRange(node, ctx);
    case "ArrayLiteral":
      return genArray(node, ctx);
    case "ObjectLiteral":
      return genObject(node, ctx);
    case "FunctionCall":
      return genFunctionCall(node, ctx);
    case "UnaryExpression":
      return genUnary(node, ctx);
    case "BinaryExpression":
      return genBinary(node, ctx);
    case "Pipeline":
      return genPipeline(node, ctx);
    default:
      return "/* unknown-node */";
  }
}

/**
 * Path code generation.
 */
function genPath(path: PathExpression, ctx: CodeGenContext): string {
  const base = path.relative === 0
    ? "i"
    : (ctx.scopes[path.relative - 1] ?? "undefined");
  return path.segments.reduce((acc, seg) => {
    if (seg.kind === "prop") return `${acc}.${seg.name}`;
    if (seg.kind === "index") return `${acc}[${seg.index}]`;
    // dynamic
    return `${acc}[${genExpr(seg.expr, ctx)}]`;
  }, base);
}

/**
 * Range literal -> f.range(start, end)
 */
function genRange(r: RangeLiteral, ctx: CodeGenContext): string {
  return `f.range(${genExpr(r.start, ctx)}, ${genExpr(r.end, ctx)})`;
}

/**
 * Array literal generation (includes embedded ranges).
 */
function genArray(arr: ArrayLiteral, ctx: CodeGenContext): string {
  return `[${
    arr.elements.map((el) =>
      el.type === "RangeLiteral"
        ? genRange(el as RangeLiteral, ctx)
        : genExpr(el as Expression, ctx)
    ).join(", ")
  }]`;
}

/**
 * Object literal generation.
 */
function genObject(obj: ObjectLiteral, ctx: CodeGenContext): string {
  return `({${
    obj.properties.map((p) =>
      `${JSON.stringify(p.key)}:${genExpr(p.value, ctx)}`
    )
      .join(", ")
  }})`;
}

/**
 * Function call generation.
 */
function genFunctionCall(fn: FunctionCall, ctx: CodeGenContext): string {
  return `f.${fn.name}(${fn.args.map((a) => genExpr(a, ctx)).join(", ")})`;
}

/**
 * Unary expression (only 'not' supported).
 */
function genUnary(un: UnaryExpression, ctx: CodeGenContext): string {
  if (un.operator === "not") {
    return `f._not(${genExpr(un.argument, ctx)})`;
  }
  return "/* unsupported-unary */";
}

/**
 * Binary expression with extended semantics.
 */
function genBinary(bin: BinaryExpression, ctx: CodeGenContext): string {
  const op = bin.operator;
  const left = genExpr(bin.left, ctx);
  const right = genExpr(bin.right, ctx);
  if (op === "&") {
    return `f.concat(${left}, ${right})`;
  }
  if (["+", "-", "*", "/", "%"].includes(op)) {
    return `f._arith(${JSON.stringify(op)}, ${left}, ${right})`;
  }
  if (["==", "!=", ">", "<", ">=", "<="].includes(op)) {
    return `f._comp(${JSON.stringify(op)}, ${left}, ${right})`;
  }
  if (["and", "or"].includes(op)) {
    return `f._logic(${JSON.stringify(op)}, ${left}, ${right})`;
  }
  return "/* unknown-binary */";
}

/**
 * Pipeline generation with filter/map scope management.
 */
function genPipeline(pipe: PipelineExpression, ctx: CodeGenContext): string {
  let acc = genExpr(pipe.input, ctx);
  const baseDepth = ctx.scopes.length;
  for (const stage of pipe.stages) {
    if (stage.name === "filter" && stage.args.length === 1) {
      const iter = nextIterVar(baseDepth);
      const inner: CodeGenContext = { scopes: [iter, ...ctx.scopes] };
      const body = genExpr(stage.args[0], inner);
      acc = `f.filter(${acc}, function(${iter}){return ${body}})`;
      continue;
    }
    if (stage.name === "map" && stage.args.length === 1) {
      const iter = nextIterVar(baseDepth);
      const inner: CodeGenContext = { scopes: [iter, ...ctx.scopes] };
      const body = genExpr(stage.args[0], inner);
      acc = `f.map(${acc}, function(${iter}){return ${body}})`;
      continue;
    }
    const callArgs = [acc, ...stage.args.map((a) => genExpr(a, ctx))].join(
      ", ",
    );
    acc = `f.${stage.name}(${callArgs})`;
  }
  return acc;
}
