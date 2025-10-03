/**
 * Shared EQL AST type definitions used by the parser and code generator.
 */
import {
  ARRAY_LITERAL,
  BINARY_EXPRESSION,
  BOOLEAN_LITERAL,
  FUNCTION_CALL,
  MESSAGE_TEMPLATE,
  NULL_LITERAL,
  NUMBER_LITERAL,
  OBJECT_LITERAL,
  PATH,
  PIPE_CALL,
  PIPELINE,
  RANGE_LITERAL,
  STRING_LITERAL,
  TEMPLATE_EMBED_KIND,
  TEMPLATE_TEXT_KIND,
  UNARY_EXPRESSION,
} from "./ast-node-types.ts";

export type NumberLiteral = { type: typeof NUMBER_LITERAL; value: number };
export type StringLiteral = { type: typeof STRING_LITERAL; value: string };
export type BooleanLiteral = { type: typeof BOOLEAN_LITERAL; value: boolean };
export type NullLiteral = { type: typeof NULL_LITERAL };

export type RangeLiteral = {
  type: typeof RANGE_LITERAL;
  start: Expression;
  end: Expression;
};

export type ArrayLiteral = {
  type: typeof ARRAY_LITERAL;
  elements: (Expression | RangeLiteral)[];
};

export type ObjectProperty = {
  key: string;
  value: Expression;
};

export type ObjectLiteral = {
  type: typeof OBJECT_LITERAL;
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
  type: typeof PATH;
  relative: number;
  segments: PathSegment[];
};

export type FunctionCall = {
  type: typeof FUNCTION_CALL;
  name: string;
  args: Expression[];
};

export type UnaryExpression = {
  type: typeof UNARY_EXPRESSION;
  operator: "not";
  argument: Expression;
};

export type BinaryExpression = {
  type: typeof BINARY_EXPRESSION;
  operator: string;
  left: Expression;
  right: Expression;
};

export type PipeStage = {
  type: typeof PIPE_CALL;
  name: string;
  args: Expression[];
};

export type PipelineExpression = {
  type: typeof PIPELINE;
  input: Expression;
  stages: PipeStage[];
};

export type Expression =
  | NumberLiteral
  | StringLiteral
  | BooleanLiteral
  | NullLiteral
  | ArrayLiteral
  | ObjectLiteral
  | RangeLiteral
  | PathExpression
  | FunctionCall
  | UnaryExpression
  | BinaryExpression
  | PipelineExpression;

export type TemplateTextPart = {
  kind: typeof TEMPLATE_TEXT_KIND;
  value: string;
};
export type TemplateEmbedPart = {
  kind: typeof TEMPLATE_EMBED_KIND;
  expr: Expression;
};

export type MessageTemplate = {
  type: typeof MESSAGE_TEMPLATE;
  parts: (TemplateTextPart | TemplateEmbedPart)[];
};
