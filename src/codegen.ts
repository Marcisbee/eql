import type {
  ArrayLiteral,
  BinaryExpression,
  Expression,
  FunctionCall,
  MessageTemplate,
  ObjectLiteral,
  PathExpression,
  PipelineExpression,
  RangeLiteral,
  UnaryExpression,
} from "./ast-types.ts";

type CodeGenContext = {
  scopes: string[]; // iter variables stack for nested filter/map
};

/**
 * Generate next iteration variable name.
 */
function nextIterVar(depth: number): string {
  return `v${depth}`;
}

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
      return "/*unknown-node*/";
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
    return `${acc}[${genExpr(seg.expr, ctx)}]`;
  }, base);
}

/**
 * Range literal -> f.range(start,end)
 */
function genRange(r: RangeLiteral, ctx: CodeGenContext): string {
  return `f.range(${genExpr(r.start, ctx)},${genExpr(r.end, ctx)})`;
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
    ).join(",")
  }]`;
}

/**
 * Object literal generation.
 */
function genObject(obj: ObjectLiteral, ctx: CodeGenContext): string {
  return `({${
    obj.properties.map((p) =>
      `${JSON.stringify(p.key)}:${genExpr(p.value, ctx)}`
    ).join(",")
  }})`;
}

/**
 * Function call generation.
 */
function genFunctionCall(fn: FunctionCall, ctx: CodeGenContext): string {
  return `f.${fn.name}(${fn.args.map((a) => genExpr(a, ctx)).join(",")})`;
}

/**
 * Unary expression (only 'not' supported).
 */
function genUnary(un: UnaryExpression, ctx: CodeGenContext): string {
  if (un.operator === "not") {
    return `f._not(${genExpr(un.argument, ctx)})`;
  }
  return "/*unsupported-unary*/";
}

/**
 * Binary expression with extended semantics.
 */
function genBinary(bin: BinaryExpression, ctx: CodeGenContext): string {
  const op = bin.operator;
  const left = genExpr(bin.left, ctx);
  const right = genExpr(bin.right, ctx);
  if (op === "&") {
    return `f.concat(${left},${right})`;
  }
  if (["+", "-", "*", "/", "%"].includes(op)) {
    return `f._arith(${JSON.stringify(op)},${left},${right})`;
  }
  if (["==", "!=", ">", "<", ">=", "<="].includes(op)) {
    return `f._comp(${JSON.stringify(op)},${left},${right})`;
  }
  if (["and", "or"].includes(op)) {
    return `f._logic(${JSON.stringify(op)},${left},${right})`;
  }
  return "/*unknown-binary*/";
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
      acc = `f.filter(${acc},function(${iter}){return ${body}})`;
      continue;
    }
    if (stage.name === "map" && stage.args.length === 1) {
      const iter = nextIterVar(baseDepth);
      const inner: CodeGenContext = { scopes: [iter, ...ctx.scopes] };
      const body = genExpr(stage.args[0], inner);
      acc = `f.map(${acc},function(${iter}){return ${body}})`;
      continue;
    }
    const callArgs = [acc, ...stage.args.map((a) => genExpr(a, ctx))].join(",");
    acc = `f.${stage.name}(${callArgs})`;
  }
  return acc;
}
