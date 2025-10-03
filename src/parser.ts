import {
  and,
  consume,
  createParser,
  createToken,
  Grammar,
  not,
  or,
  peek,
  rule,
  skipIn,
  zeroOrMany,
  zeroOrManySep,
  zeroOrOne,
} from "nanolex";
import type {
  ArrayLiteral,
  BinaryExpression,
  BooleanLiteral,
  Expression,
  FunctionCall,
  MessageTemplate,
  NullLiteral,
  NumberLiteral,
  ObjectLiteral,
  ObjectProperty,
  PathExpression,
  PathSegment,
  PipelineExpression,
  PipeStage,
  RangeLiteral,
  StringLiteral,
  TemplateEmbedPart,
  TemplateTextPart,
  UnaryExpression,
} from "./ast-types.ts";
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

/* ---------------------------------- Tokens --------------------------------- */
const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");

/* Multi-character operators & sequences */
const EqEq = createToken("==");
const NotEq = createToken("!=");
const Gte = createToken(">=");
const Lte = createToken("<=");
const DoubleDot = createToken("..");

/* Single-character punctuation / operators */
const Dot = createToken(".");
const LParen = createToken("(");
const RParen = createToken(")");
const LBracket = createToken("[");
const RBracket = createToken("]");
const LBrace = createToken("{");
const RBrace = createToken("}");
const Comma = createToken(",");
const Colon = createToken(":");
const PipeTok = createToken("|");
const Plus = createToken("+");
const Minus = createToken("-");
const Star = createToken("*");
const Slash = createToken("/");
const Percent = createToken("%");
const Amp = createToken("&");
const Gt = createToken(">");
const Lt = createToken("<");
const Escape = createToken("\\");

/* Keywords */
const AndTok = createToken("and");
const OrTok = createToken("or");
const NotTok = createToken("not");
const True = createToken("true");
const False = createToken("false");
const NullTok = createToken("null");

/* Literals */
const NumberTok = createToken(/[0-9]+(?:\.[0-9]+)?/, "Number");
const StringTok = createToken(/"(?:\\.|[^"\\])*"/, "String");

/* Identifier */
const Identifier = createToken(/[a-zA-Z_][a-zA-Z0-9_]*/, "Identifier");

/* Template fallback text (anything except '{'). We keep '}' allowed per spec. */
const Any = createToken(/[^{]+/, "Any");

/**
 * Token ordering: longest / specific first.
 * Keywords must precede Identifier to avoid being captured as generic identifiers.
 */
const tokens = [
  Whitespace,
  EqEq,
  NotEq,
  Gte,
  Lte,
  DoubleDot,
  Dot,
  LParen,
  RParen,
  LBracket,
  RBracket,
  LBrace,
  RBrace,
  Comma,
  Colon,
  PipeTok,
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  Amp,
  Gt,
  Lt,
  Escape,
  NumberTok,
  StringTok,
];

/* ------------------------------ String Handling ----------------------------- */
/**
 * Unquote and unescape a JSON-like string literal.
 */
function unquote(raw: string): string {
  return raw
    .slice(1, -1)
    .replace(/\\(["\\/bfnrt])/g, (_m, c) => {
      switch (c) {
        case '"':
        case "\\":
        case "/":
          return c;
        case "b":
          return "\b";
        case "f":
          return "\f";
        case "n":
          return "\n";
        case "r":
          return "\r";
        case "t":
          return "\t";
        default:
          return c;
      }
    })
    .replace(
      /\\u([0-9a-fA-F]{4})/g,
      (_m, hex) => String.fromCharCode(parseInt(hex, 16)),
    );
}

/* --------------------------- Infix / Operator Helpers ----------------------- */
interface OpRight {
  op: string;
  right: Expression;
}

/**
 * Build left-associative chains of binary expressions.
 */
function chainInfix(first: Expression, rest: OpRight[]): Expression {
  return rest.reduce(
    (acc, { op, right }) =>
      ({
        type: BINARY_EXPRESSION,
        operator: op,
        left: acc,
        right,
      }) as BinaryExpression,
    first,
  );
}

/* Reusable operator choice grammars */
const OrOp = consume(OrTok);
const AndOp = consume(AndTok);
const CompareOps = or([
  consume(EqEq),
  consume(NotEq),
  consume(Gte),
  consume(Lte),
  consume(Gt),
  consume(Lt),
]);
const AddOps = or([
  consume(Plus),
  consume(Minus),
  consume(Amp), // string concatenation
]);
const MulOps = or([
  consume(Star),
  consume(Slash),
  consume(Percent),
]);

/* Map small tuple -> OpRight */
const mapOpRight = (values: readonly unknown[]): OpRight => ({
  op: values[0] as string,
  right: values[1] as Expression,
});

/* ------------------------------- Parser Grammar ----------------------------- */
const parser = createParser(
  tokens,
  {
    /* ----------------------- Expression Grammar Root ----------------------- */
    EXPR() {
      // Skip whitespace only inside expression tree.
      return skipIn(consume(Whitespace), rule(this.OR));
    },

    OR(): Grammar<Expression> {
      return and(
        [
          rule(this.AND),
          zeroOrMany(and([OrOp, rule(this.AND)], mapOpRight)),
        ],
        ([first, rest]) => chainInfix(first as Expression, rest as OpRight[]),
      );
    },

    AND(): Grammar<Expression> {
      return and(
        [
          rule(this.COMPARISON),
          zeroOrMany(and([AndOp, rule(this.COMPARISON)], mapOpRight)),
        ],
        ([first, rest]) => chainInfix(first as Expression, rest as OpRight[]),
      );
    },

    COMPARISON(): Grammar<Expression> {
      return and(
        [
          rule(this.ADDITIVE),
          zeroOrMany(and([CompareOps, rule(this.ADDITIVE)], mapOpRight)),
        ],
        ([first, rest]) => chainInfix(first as Expression, rest as OpRight[]),
      );
    },

    ADDITIVE(): Grammar<Expression> {
      return and(
        [
          rule(this.MULTIPLICATIVE),
          zeroOrMany(and([AddOps, rule(this.MULTIPLICATIVE)], mapOpRight)),
        ],
        ([first, rest]) => chainInfix(first as Expression, rest as OpRight[]),
      );
    },

    MULTIPLICATIVE(): Grammar<Expression> {
      return and(
        [
          rule(this.UNARY),
          zeroOrMany(and([MulOps, rule(this.UNARY)], mapOpRight)),
        ],
        ([first, rest]) => chainInfix(first as Expression, rest as OpRight[]),
      );
    },

    UNARY(): Grammar<UnaryExpression | PipelineExpression | Expression> {
      return or([
        and(
          [consume(NotTok), rule(this.UNARY)],
          ([, arg]) =>
            ({
              type: UNARY_EXPRESSION,
              operator: "not",
              argument: arg,
            }) as UnaryExpression,
        ),
        rule(this.PIPELINE),
      ]);
    },

    PIPELINE(): Grammar<PipelineExpression | Expression> {
      return and(
        [
          rule(this.PRIMARY),
          zeroOrMany(
            and([consume(PipeTok), rule(this.PIPE_FUNC)], ([, f]) => f),
          ),
        ],
        ([base, stages]) => {
          const s = stages as PipeStage[];
          if (s.length === 0) return base as Expression;
          return {
            type: PIPELINE,
            input: base as Expression,
            stages: s,
          } as PipelineExpression;
        },
      );
    },

    PRIMARY() {
      return or([
        rule(this.FUNCTION_CALL),
        rule(this.PATH),
        rule(this.LITERAL),
        and(
          [consume(LParen), rule(this.EXPR), consume(RParen)],
          ([, expr]) => expr,
        ),
      ]);
    },

    FUNCTION_CALL(): Grammar<FunctionCall> {
      return and(
        [
          consume(Identifier),
          consume(LParen),
          zeroOrOne(rule(this.ARG_LIST)),
          consume(RParen),
        ],
        ([name, , args]) =>
          ({
            type: FUNCTION_CALL,
            name,
            args: (args ?? []) as Expression[],
          }) as FunctionCall,
      );
    },

    ARG_LIST() {
      return zeroOrManySep(rule(this.EXPR), consume(Comma));
    },

    /* ------------------------------ Path Parsing --------------------------- */
    PATH(): Grammar<PathExpression> {
      return and(
        [
          not(or([consume(True), consume(False), consume(NullTok)])),
          rule(this.PATH_HEAD),
          rule(this.PATH_TAIL),
        ],
        ([, head, tail]) => {
          const segments: PathSegment[] = [
            { kind: "prop", name: head.first },
            ...(tail as PathSegment[]),
          ];
          return {
            type: PATH,
            relative: head.depth,
            segments,
          } as PathExpression;
        },
      );
    },

    PATH_HEAD() {
      return and(
        [
          zeroOrMany(or([consume(Dot), consume(DoubleDot)])),
          consume(Identifier),
        ],
        ([dots, ident]) => {
          let depth = 0;
          for (const d of dots as string[]) {
            depth += d === ".." ? 2 : 1;
          }
          return { depth, first: ident };
        },
      );
    },

    PATH_TAIL() {
      return zeroOrMany(
        or([
          and(
            [consume(Dot), consume(Identifier)],
            ([, ident]) => ({ kind: "prop", name: ident } as PathSegment),
          ),
          and(
            [consume(Dot), consume(NumberTok)],
            ([, num]) => ({ kind: "index", index: Number(num) } as PathSegment),
          ),
          rule(this.DYNAMIC_SEG),
        ]),
      );
    },

    DYNAMIC_SEG(): Grammar<PathSegment> {
      return and(
        [consume(LBracket), rule(this.EXPR), consume(RBracket)],
        ([, expr]) => ({ kind: "dynamic", expr } as PathSegment),
      );
    },

    /* ------------------------------- Literals ------------------------------ */
    LITERAL() {
      return or([
        and(
          [consume(Minus), consume(NumberTok)],
          ([, n]) =>
            ({ type: NUMBER_LITERAL, value: -Number(n) }) as NumberLiteral,
        ),
        consume(
          NumberTok,
          (n) => ({ type: NUMBER_LITERAL, value: Number(n) }) as NumberLiteral,
        ),
        consume(
          StringTok,
          (s) => ({ type: STRING_LITERAL, value: unquote(s) }) as StringLiteral,
        ),
        consume(
          True,
          () => ({ type: BOOLEAN_LITERAL, value: true }) as BooleanLiteral,
        ),
        consume(
          False,
          () => ({ type: BOOLEAN_LITERAL, value: false }) as BooleanLiteral,
        ),
        consume(
          NullTok,
          () => ({ type: NULL_LITERAL }) as NullLiteral,
        ),
        rule(this.ARRAY_LITERAL),
        rule(this.OBJECT_LITERAL),
      ]);
    },

    ARRAY_LITERAL(): Grammar<ArrayLiteral> {
      return and(
        [
          consume(LBracket),
          zeroOrOne(rule(this.ARRAY_ELEMENTS)),
          consume(RBracket),
        ],
        ([, elements]) =>
          ({
            type: ARRAY_LITERAL,
            elements: (elements ?? []) as (Expression | RangeLiteral)[],
          }) as ArrayLiteral,
      );
    },

    ARRAY_ELEMENTS() {
      return zeroOrManySep(rule(this.ARRAY_ITEM), consume(Comma));
    },

    ARRAY_ITEM() {
      return or([
        rule(this.RANGE_ITEM),
        rule(this.EXPR),
      ]);
    },

    RANGE_ITEM(): Grammar<RangeLiteral> {
      return and(
        [rule(this.EXPR), consume(DoubleDot), rule(this.EXPR)],
        ([start, , end]) =>
          ({ type: RANGE_LITERAL, start, end }) as RangeLiteral,
      );
    },

    OBJECT_LITERAL(): Grammar<ObjectLiteral> {
      return and(
        [
          consume(LBrace),
          zeroOrOne(rule(this.OBJECT_PAIRS)),
          consume(RBrace),
        ],
        ([, props]) =>
          ({
            type: OBJECT_LITERAL,
            properties: (props ?? []) as ObjectProperty[],
          }) as ObjectLiteral,
      );
    },

    OBJECT_PAIRS() {
      return zeroOrManySep(rule(this.OBJECT_PAIR), consume(Comma));
    },

    OBJECT_PAIR(): Grammar<ObjectProperty> {
      return and(
        [
          or([consume(Identifier), consume(StringTok)]),
          consume(Colon),
          rule(this.EXPR),
        ],
        ([rawKey, , value]) => {
          const key = rawKey.startsWith('"') ? unquote(rawKey) : rawKey;
          return { key, value } as ObjectProperty;
        },
      );
    },

    /* -------------------------- Pipeline Function Stage ------------------- */
    PIPE_FUNC(): Grammar<PipeStage> {
      return and(
        [
          consume(Identifier),
          zeroOrOne(
            and([
              consume(LParen),
              zeroOrOne(rule(this.ARG_LIST)),
              consume(RParen),
            ]),
          ),
        ],
        ([name, argsMaybe]) => {
          const args = argsMaybe ? (argsMaybe[1] ?? []) : [];
          return {
            type: PIPE_CALL,
            name,
            args,
          } as PipeStage;
        },
      );
    },

    /* ------------------------- Message Template Grammar ------------------- */
    SEGMENT() {
      return or([
        // Escaped brace: \{
        and(
          [consume(Escape), consume(LBrace)],
          (
            [, value],
          ) => ({ kind: TEMPLATE_TEXT_KIND, value } as TemplateTextPart),
        ),
        // Embed: { EXPR? }
        and(
          [
            consume(LBrace),
            or([
              rule(this.EXPR),
              skipIn(
                consume(Whitespace),
                peek(
                  consume(
                    RBrace,
                    () => ({ type: NULL_LITERAL } as NullLiteral),
                  ),
                ),
              ),
            ]),
            consume(RBrace),
          ],
          (
            [, expr],
          ) => ({ kind: TEMPLATE_EMBED_KIND, expr } as TemplateEmbedPart),
        ),
        // Fallback text
        consume(
          Any,
          (value) => ({ kind: TEMPLATE_TEXT_KIND, value } as TemplateTextPart),
        ),
      ]);
    },

    MESSAGE(): Grammar<MessageTemplate> {
      return zeroOrMany(rule(this.SEGMENT), (parts) =>
        ({
          type: MESSAGE_TEMPLATE,
          parts,
        }) as MessageTemplate);
    },
  },
);

/* -------------------------------- Public API -------------------------------- */
/**
 * Parse a query (single expression) and return its AST.
 */
export function parseQuery(input: string): Expression {
  return parser("EXPR", input) as Expression;
}

/**
 * Parse a message template and return its AST.
 */
export function parseMessage(input: string): MessageTemplate {
  return parser("MESSAGE", input) as MessageTemplate;
}
