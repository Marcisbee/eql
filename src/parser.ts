import {
  and,
  consume,
  createParser,
  createToken,
  Grammar,
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
// const True = createToken("true");
// const False = createToken("false");
// const NullTok = createToken("null");

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
  NumberTok,
  StringTok,
];

/* ------------------------------ String Handling ----------------------------- */
/**
 * Unquote and unescape a JSON-like string literal.
 */
function unquote(s: string): string {
  // Single-pass unescape (assumes valid string literal form)
  let out = "";
  const end = s.length - 1;
  for (let i = 1; i < end; i++) {
    const c = s[i];
    if (c === "\\") {
      i++;
      if (i >= end) break;
      const esc = s[i];
      switch (esc) {
        case '"':
        case "\\":
        case "/":
          out += esc;
          continue;
        case "b":
          out += "\b";
          continue;
        case "f":
          out += "\f";
          continue;
        case "n":
          out += "\n";
          continue;
        case "r":
          out += "\r";
          continue;
        case "t":
          out += "\t";
          continue;
        case "u": {
          // Expect 4 hex digits
          const h1 = s.charCodeAt(i + 1);
          const h2 = s.charCodeAt(i + 2);
          const h3 = s.charCodeAt(i + 3);
          const h4 = s.charCodeAt(i + 4);
          const toHexVal = (cc: number): number => {
            if (cc >= 48 && cc <= 57) return cc - 48; // 0-9
            if (cc >= 65 && cc <= 70) return cc - 55; // A-F
            if (cc >= 97 && cc <= 102) return cc - 87; // a-f
            return 0;
          };
          const code = (toHexVal(h1) << 12) |
            (toHexVal(h2) << 8) |
            (toHexVal(h3) << 4) |
            toHexVal(h4);
          out += String.fromCharCode(code);
          i += 4;
          continue;
        }
        default:
          out += esc;
          continue;
      }
    } else {
      out += c;
    }
  }
  return out;
}

/* --------------------------- Infix / Operator Helpers ----------------------- */
interface OpRight {
  op: string;
  right: Expression;
}
function leftAssoc(
  term: Grammar<Expression>,
  op: Grammar<string>,
): Grammar<Expression> {
  return and(
    [
      term,
      zeroOrMany(and([op, term], (values): OpRight => ({
        op: values[0] as string,
        right: values[1] as Expression,
      }))),
    ],
    ([first, rest]) => {
      let acc = first as Expression;
      const ops = rest as OpRight[];
      for (let i = 0; i < ops.length; i++) {
        const { op, right } = ops[i];
        acc = ({
          type: BINARY_EXPRESSION,
          operator: op,
          left: acc,
          right,
        }) as BinaryExpression;
      }
      return acc;
    },
  );
}

/* ------------------------------- Parser Grammar ----------------------------- */
const parser = createParser(
  tokens,
  {
    /* ----------------------- Expression Grammar Root ----------------------- */
    EXPR() {
      return skipIn(consume(Whitespace), rule(this.OR));
    },

    OR(): Grammar<Expression> {
      return leftAssoc(rule(this.AND), consume(OrTok));
    },

    AND(): Grammar<Expression> {
      return leftAssoc(rule(this.COMPARISON), consume(AndTok));
    },

    COMPARISON(): Grammar<Expression> {
      return leftAssoc(
        rule(this.ADDITIVE),
        or([
          consume(EqEq),
          consume(NotEq),
          consume(Gte),
          consume(Lte),
          consume(Gt),
          consume(Lt),
        ]),
      );
    },

    ADDITIVE(): Grammar<Expression> {
      return leftAssoc(
        rule(this.MULTIPLICATIVE),
        or([
          consume(Plus),
          consume(Minus),
          consume(Amp),
        ]),
      );
    },

    MULTIPLICATIVE(): Grammar<Expression> {
      return leftAssoc(
        rule(this.UNARY),
        or([
          consume(Star),
          consume(Slash),
          consume(Percent),
        ]),
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
          [consume(LParen), rule(this.OR), consume(RParen)],
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
            args: args as Expression[],
          }) as FunctionCall,
      );
    },

    ARG_LIST() {
      return zeroOrManySep(rule(this.OR), consume(Comma));
    },

    /* ------------------------------ Path Parsing --------------------------- */
    PATH(): Grammar<PathExpression | BooleanLiteral | NullLiteral> {
      return and(
        [
          rule(this.PATH_HEAD),
          rule(this.PATH_TAIL),
        ],
        ([head, tail]) => {
          if (head.first === "true") {
            return { type: BOOLEAN_LITERAL, value: true } as BooleanLiteral;
          }

          if (head.first === "false") {
            return { type: BOOLEAN_LITERAL, value: false } as BooleanLiteral;
          }

          if (head.first === "null") {
            return { type: NULL_LITERAL } as NullLiteral;
          }

          return {
            type: PATH,
            relative: head.depth,
            segments: [
              { kind: "prop", name: head.first } as PathSegment,
              ...(tail as PathSegment[]),
            ] as PathSegment[],
          } as PathExpression;
        },
      );
    },

    PATH_HEAD() {
      return and(
        [
          zeroOrMany(consume(Dot)),
          consume(Identifier),
        ],
        ([dots, ident]) => {
          return { depth: dots.length, first: ident };
        },
      );
    },

    PATH_TAIL() {
      return zeroOrMany(
        or([
          and(
            [
              consume(Dot),
              or([
                consume(
                  Identifier,
                  (ident) => ({ kind: "prop", name: ident } as PathSegment),
                ),
                consume(
                  NumberTok,
                  (
                    num,
                  ) => ({ kind: "index", index: Number(num) } as PathSegment),
                ),
              ]),
            ],
            ([, seg]) => seg as PathSegment,
          ),
          rule(this.DYNAMIC_SEG),
        ]),
      );
    },

    DYNAMIC_SEG(): Grammar<PathSegment> {
      return and(
        [consume(LBracket), rule(this.OR), consume(RBracket)],
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
            elements: elements as (Expression | RangeLiteral)[],
          }) as ArrayLiteral,
      );
    },

    ARRAY_ELEMENTS() {
      return zeroOrManySep(rule(this.ARRAY_ITEM), consume(Comma));
    },

    ARRAY_ITEM() {
      return or([
        rule(this.RANGE_ITEM),
        rule(this.OR),
      ]);
    },

    RANGE_ITEM(): Grammar<RangeLiteral> {
      return and(
        [rule(this.OR), consume(Dot), consume(Dot), rule(this.OR)],
        ([start, , , end]) =>
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
            properties: props as ObjectProperty[],
          }) as ObjectLiteral,
      );
    },

    OBJECT_PAIRS() {
      return zeroOrManySep(rule(this.OBJECT_PAIR), consume(Comma));
    },

    OBJECT_PAIR(): Grammar<ObjectProperty> {
      return and(
        [
          or([consume(Identifier), consume(StringTok, unquote)]),
          consume(Colon),
          rule(this.OR),
        ],
        ([key, , value]) => {
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
          return {
            type: PIPE_CALL,
            name,
            args: argsMaybe ? argsMaybe[1] : [],
          } as PipeStage;
        },
      );
    },

    /* ------------------------- Message Template Grammar ------------------- */
    SEGMENT() {
      return or([
        and(
          [consume(Escape), consume(LBrace)],
          (
            [, value],
          ) => ({ kind: TEMPLATE_TEXT_KIND, value } as TemplateTextPart),
        ),
        and(
          [
            consume(LBrace),
            skipIn(
              consume(Whitespace),
              or([
                rule(this.OR),
                peek(
                  consume(
                    RBrace,
                    () => ({ type: NULL_LITERAL } as NullLiteral),
                  ),
                ),
              ]),
            ),
            consume(RBrace),
          ],
          (
            [, expr],
          ) => ({ kind: TEMPLATE_EMBED_KIND, expr } as TemplateEmbedPart),
        ),
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
