/**
 * Centralized AST node and template part type string constants.
 * Use these constants instead of raw string literals for `type` / `kind` fields.
 *
 * NOTE:
 * - Node "type" field constants are UPPER_SNAKE_CASE.
 * - Template part "kind" field constants (text/embed) are also provided.
 */

/* ----------------------------- AST Node Types ----------------------------- */
export const NUMBER_LITERAL = "NumberLiteral" as const;
export const STRING_LITERAL = "StringLiteral" as const;
export const BOOLEAN_LITERAL = "BooleanLiteral" as const;
export const NULL_LITERAL = "NullLiteral" as const;

export const RANGE_LITERAL = "RangeLiteral" as const;
export const ARRAY_LITERAL = "ArrayLiteral" as const;
export const OBJECT_LITERAL = "ObjectLiteral" as const;

export const PATH = "Path" as const;

export const FUNCTION_CALL = "FunctionCall" as const;
export const UNARY_EXPRESSION = "UnaryExpression" as const;
export const BINARY_EXPRESSION = "BinaryExpression" as const;

export const PIPE_CALL = "PipeCall" as const;
export const PIPELINE = "Pipeline" as const;

export const MESSAGE_TEMPLATE = "MessageTemplate" as const;

/* -------------------------- Template Part Kinds --------------------------- */
export const TEMPLATE_TEXT_KIND = "text" as const;
export const TEMPLATE_EMBED_KIND = "embed" as const;

/* ----------------------------- Union Type Sets ---------------------------- */
export type AstNodeType =
  | typeof NUMBER_LITERAL
  | typeof STRING_LITERAL
  | typeof BOOLEAN_LITERAL
  | typeof NULL_LITERAL
  | typeof RANGE_LITERAL
  | typeof ARRAY_LITERAL
  | typeof OBJECT_LITERAL
  | typeof PATH
  | typeof FUNCTION_CALL
  | typeof UNARY_EXPRESSION
  | typeof BINARY_EXPRESSION
  | typeof PIPE_CALL
  | typeof PIPELINE
  | typeof MESSAGE_TEMPLATE;

export type TemplatePartKind =
  | typeof TEMPLATE_TEXT_KIND
  | typeof TEMPLATE_EMBED_KIND;
