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

/* Tokens */
const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");

/* Multi-character operators & sequences */
const EqEq = createToken("==");
const NotEq = createToken("!=");
const Gte = createToken(">=");
const Lte = createToken("<=");
const DoubleDot = createToken("..");

/* Single-char punctuation */
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

/* Template text fallback (anything except '{') */
const Any = createToken(/[^{]+/, "Any");

/* Token list (order matters) */
const tokens = [
  // Punctuation / operators (multi-char first)
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
  // Literals
  NumberTok,
  StringTok,
];

/**
 * Utility: unquote and unescape a JSON-like string literal.
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

/**
 * Helper to build left-associative binary expression chains.
 */
function chainInfix(
  first: Expression,
  rest: { op: string; right: Expression }[],
): Expression {
  return rest.reduce(
    (acc, { op, right }) =>
      ({
        type: "BinaryExpression",
        operator: op,
        left: acc,
        right,
      }) as BinaryExpression,
    first,
  );
}

/**
 * Build a single parser instance with rules for both expressions and message templates.
 *
 * Design:
 * - No global skip rule: we need to capture whitespace in message templates.
 * - Expression root rule (EXPR) installs local skip (Whitespace) via skipIn.
 */
const parser = createParser(
  tokens,
  {
    /* ---------- Expression Grammar (with precedence) ---------- */

    EXPR() {
      // Local whitespace skipping for the whole expression tree.
      return skipIn(consume(Whitespace), rule(this.OR));
    },

    OR(): Grammar<BinaryExpression | Expression> {
      return and(
        [
          rule(this.AND),
          zeroOrMany(and([consume(OrTok), rule(this.AND)], ([, e]) => e)),
        ],
        ([first, rest]) => {
          let acc = first as Expression;
          for (const r of rest as Expression[]) {
            acc = {
              type: "BinaryExpression",
              operator: "or",
              left: acc,
              right: r,
            } as BinaryExpression;
          }
          return acc;
        },
      );
    },

    AND(): Grammar<BinaryExpression | Expression> {
      return and(
        [
          rule(this.COMPARISON),
          zeroOrMany(
            and([consume(AndTok), rule(this.COMPARISON)], ([, e]) => e),
          ),
        ],
        ([first, rest]) => {
          let acc = first as Expression;
          for (const r of rest as Expression[]) {
            acc = {
              type: "BinaryExpression",
              operator: "and",
              left: acc,
              right: r,
            } as BinaryExpression;
          }
          return acc;
        },
      );
    },

    COMPARISON() {
      return and(
        [
          rule(this.ADDITIVE),
          zeroOrMany(
            and(
              [
                or([
                  consume(EqEq),
                  consume(NotEq),
                  consume(Gte),
                  consume(Lte),
                  consume(Gt),
                  consume(Lt),
                ]),
                rule(this.ADDITIVE),
              ],
              ([op, right]) => ({ op, right }),
            ),
          ),
        ],
        ([first, rest]) =>
          chainInfix(
            first as Expression,
            rest as { op: string; right: Expression }[],
          ),
      );
    },

    ADDITIVE() {
      return and(
        [
          rule(this.MULTIPLICATIVE),
          zeroOrMany(
            and(
              [
                or([
                  consume(Plus),
                  consume(Minus),
                  consume(Amp),
                ]),
                rule(this.MULTIPLICATIVE),
              ],
              ([op, right]) => ({ op, right }),
            ),
          ),
        ],
        ([first, rest]) =>
          chainInfix(
            first as Expression,
            rest as { op: string; right: Expression }[],
          ),
      );
    },

    MULTIPLICATIVE() {
      return and(
        [
          rule(this.UNARY),
          zeroOrMany(
            and(
              [
                or([
                  consume(Star),
                  consume(Slash),
                  consume(Percent),
                ]),
                rule(this.UNARY),
              ],
              ([op, right]) => ({ op, right }),
            ),
          ),
        ],
        ([first, rest]) =>
          chainInfix(
            first as Expression,
            rest as { op: string; right: Expression }[],
          ),
      );
    },

    UNARY(): Grammar<UnaryExpression | PipelineExpression | Expression> {
      return or([
        and(
          [consume(NotTok), rule(this.UNARY)],
          ([, arg]) =>
            ({
              type: "UnaryExpression",
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
            and(
              [consume(PipeTok), rule(this.PIPE_FUNC)],
              ([, f]) => f,
            ),
          ),
        ],
        ([base, stages]) => {
          const s = stages as PipeStage[];
          if (s.length === 0) return base as Expression;
          return {
            type: "Pipeline",
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
            type: "FunctionCall",
            name,
            args: (args ?? []) as Expression[],
          }) as FunctionCall,
      );
    },

    ARG_LIST() {
      return zeroOrManySep(rule(this.EXPR), consume(Comma));
    },

    /* ---------- Path Parsing ---------- */

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
            type: "Path",
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

    /* ---------- Literals ---------- */

    LITERAL() {
      return or([
        and(
          [consume(Minus), consume(NumberTok)],
          ([, n]) =>
            ({ type: "NumberLiteral", value: -Number(n) }) as NumberLiteral,
        ),
        consume(
          NumberTok,
          (n) => ({ type: "NumberLiteral", value: Number(n) }) as NumberLiteral,
        ),
        consume(
          StringTok,
          (s) =>
            ({ type: "StringLiteral", value: unquote(s) }) as StringLiteral,
        ),
        consume(
          True,
          () => ({ type: "BooleanLiteral", value: true }) as BooleanLiteral,
        ),
        consume(
          False,
          () => ({ type: "BooleanLiteral", value: false }) as BooleanLiteral,
        ),
        consume(
          NullTok,
          () => ({ type: "NullLiteral" }) as NullLiteral,
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
            type: "ArrayLiteral",
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
          ({ type: "RangeLiteral", start, end }) as RangeLiteral,
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
            type: "ObjectLiteral",
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

    /* ---------- Pipeline Function Stage ---------- */

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
            type: "PipeCall",
            name,
            args,
          } as PipeStage;
        },
      );
    },

    /* ---------- Message Template Grammar ---------- */

    SEGMENT() {
      return or([
        // Escaped brace: \{
        and(
          [consume(Escape), consume(LBrace)],
          ([, value]) => ({ kind: "text", value } as TemplateTextPart),
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
                    () => ({ type: "NullLiteral" } as NullLiteral),
                  ),
                ),
              ),
            ]),
            consume(RBrace),
          ],
          ([, expr]) => ({ kind: "embed", expr } as TemplateEmbedPart),
        ),
        // Fallback text
        consume(
          Any,
          (value) => ({ kind: "text", value } as TemplateTextPart),
        ),
      ]);
    },

    MESSAGE(): Grammar<MessageTemplate> {
      return zeroOrMany(rule(this.SEGMENT), (parts) =>
        ({
          type: "MessageTemplate",
          parts,
        }) as MessageTemplate);
    },
  },
);

export function parseQuery(input: string): Expression {
  return parser("EXPR", input) as Expression;
}

export function parseMessage(input: string): MessageTemplate {
  return parser("MESSAGE", input) as MessageTemplate;
}
