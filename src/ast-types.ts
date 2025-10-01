/**
 * Shared EQL AST type definitions used by the parser and code generator.
 */
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
  relative: number;
  segments: PathSegment[];
};

export type FunctionCall = {
  type: "FunctionCall";
  name: string;
  args: Expression[];
};

export type UnaryExpression = {
  type: "UnaryExpression";
  operator: "not";
  argument: Expression;
};

export type BinaryExpression = {
  type: "BinaryExpression";
  operator: string;
  left: Expression;
  right: Expression;
};

export type PipeStage = {
  type: "PipeCall";
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
  | ArrayLiteral
  | ObjectLiteral
  | RangeLiteral
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
