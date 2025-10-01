/**
 * EQL AST parser implemented with nanolex.
 *
 * This covers:
 * - All literal types (number, string, boolean, null, arrays, objects, ranges)
 * - Paths (global + relative with dot depth, dynamic [expr] segments)
 * - Function calls
 * - Operators with correct precedence
 * - Pipelines (tight precedence with functions per spec)
 * - Message mode templates ("... { expr } ...")
 *
 * NOTE:
 * - Semantic validation (e.g., relative paths only inside filter/map) is deferred to the evaluator.
 * - Negative indices are expected via bracket notation (e.g. items[-1]) — unary minus
 *   is not part of the spec grammar, so direct "-1" literal is not supported outside
 *   a subtraction expression.
 */

import {
  createPattern,
  createToken,
  EOF,
  getComposedTokens,
  nanolex,
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

const Whitespace = createToken(/[ \t\r\n]+/, "Whitespace");

/* Multi-character operators & sequences */
const EqEq = createToken("==");
const NotEq = createToken("!=");
const Gte = createToken(">=");
const Lte = createToken("<=");
const DoubleDot = createToken(".."); // range or relative path grouping
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
const Pipe = createToken("|");
const Plus = createToken("+");
const Minus = createToken("-");
const Star = createToken("*");
const Slash = createToken("/");
const Percent = createToken("%");
const Amp = createToken("&");
const Gt = createToken(">");
const Lt = createToken("<");

/* Keywords */
const And = createToken(/\band\b/, "And");
const Or = createToken(/\bor\b/, "Or");
const Not = createToken(/\bnot\b/, "Not");
const True = createToken(/\btrue\b/, "True");
const False = createToken(/\bfalse\b/, "False");
const NullTok = createToken(/\bnull\b/, "Null");

/* Literals */
const NumberTok = createToken(/[0-9]+(?:\.[0-9]+)?/, "Number");
const StringTok = createToken(
  /"(?:\\.|[^"\\])*"/,
  "String",
);

/* Identifier (after keywords to avoid conflicts) */
const Identifier = createToken(/[a-zA-Z_][a-zA-Z0-9_]*/, "Identifier");

/* Compose tokens list */
const tokens = getComposedTokens([
  Whitespace,

  /* Operators / punctuation (multi first) */
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
  Pipe,
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  Amp,
  Gt,
  Lt,

  /* Keywords */
  And,
  Or,
  Not,
  True,
  False,
  NullTok,

  /* Literals */
  NumberTok,
  StringTok,

  /* Identifier */
  Identifier,
]);

const EXPR = createPattern("EXPR");
const OR = createPattern("OR");
const AND = createPattern("AND");
const COMPARISON = createPattern("COMPARISON");
const ADDITIVE = createPattern("ADDITIVE");
const MULTIPLICATIVE = createPattern("MULTIPLICATIVE");
const UNARY = createPattern("UNARY");
const PIPELINE = createPattern("PIPELINE");
const PRIMARY = createPattern("PRIMARY");
const FUNCTION_CALL = createPattern("FUNCTION_CALL");
const PATH = createPattern("PATH");
const PATH_HEAD = createPattern("PATH_HEAD");
const PATH_TAIL = createPattern("PATH_TAIL");
const DYNAMIC_SEG = createPattern("DYNAMIC_SEG");
const ARRAY_LITERAL = createPattern("ARRAY_LITERAL");
const ARRAY_ELEMENTS = createPattern("ARRAY_ELEMENTS");
const ARRAY_ITEM = createPattern("ARRAY_ITEM");
const RANGE_ITEM = createPattern("RANGE_ITEM");
const OBJECT_LITERAL = createPattern("OBJECT_LITERAL");
const OBJECT_PAIRS = createPattern("OBJECT_PAIRS");
const OBJECT_PAIR = createPattern("OBJECT_PAIR");
const LITERAL = createPattern("LITERAL");
const ARG_LIST = createPattern("ARG_LIST");
const PIPE_TAIL = createPattern("PIPE_TAIL");
const PIPE_FUNC = createPattern("PIPE_FUNC");

function buildParser(input: string) {
  const {
    consume,
    and,
    or,
    not,
    zeroOrMany,
    zeroOrManySep,
    zeroOrOne,
    patternToSkip,
    throwIfError,
  } = nanolex(input, tokens);

  // Skip whitespace globally
  patternToSkip(consume(Whitespace));

  /**
   * Utility builders
   */
  const toNumber = (raw: string) => Number(raw);
  const unquote = (raw: string) =>
    raw
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
      .replace(/\\u([0-9a-fA-F]{4})/g, (_m, hex) =>
        String.fromCharCode(parseInt(hex, 16)));

  /**
   * ARG_LIST -> (EXPR (',' EXPR)*)?
   */
  ARG_LIST.set = zeroOrManySep(EXPR, consume(Comma));

  /**
   * FUNCTION_CALL -> Identifier '(' ARG_LIST ')'
   */
  FUNCTION_CALL.set = and(
    [
      consume(Identifier),
      consume(LParen),
      zeroOrOne(ARG_LIST),
      consume(RParen),
    ],
    ([name, , args]) =>
      ({
        type: "FunctionCall",
        name,
        args: args ?? [],
      }) as FunctionCall,
  );

  /**
   * PATH parsing
   *
   * Relative prefix: sequence of Dot / DoubleDot before first Identifier
   *   '.' => depth +1
   *   '..' => depth +2
   */
  PATH_HEAD.set = and(
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

  DYNAMIC_SEG.set = and(
    [consume(LBracket), EXPR, consume(RBracket)],
    ([, expr]) => ({ kind: "dynamic", expr } as PathSegment),
  );

  PATH_TAIL.set = zeroOrMany(
    or([
      // .identifier
      and([consume(Dot), consume(Identifier)], ([, ident]) => ({
        kind: "prop",
        name: ident,
      })),
      // .number (index)
      and([consume(Dot), consume(NumberTok)], ([, num]) => ({
        kind: "index",
        index: Number(num),
      })),
      // dynamic [...]
      DYNAMIC_SEG,
    ]),
  );

  PATH.set = and([
    not(or([consume(True), consume(False), consume(NullTok)])),
    PATH_HEAD,
    PATH_TAIL,
  ], ([, head, tail]) => {
    const segments: PathSegment[] = [
      { kind: "prop", name: head.first },
      ...(tail as PathSegment[]),
    ];
    return {
      type: "Path",
      relative: head.depth,
      segments,
    } as PathExpression;
  });

  /**
   * Literals
   */
  LITERAL.set = or([
    // Negative number literal: '-' NumberTok
    and(
      [consume(Minus), consume(NumberTok)],
      ([, n]) =>
        ({ type: "NumberLiteral", value: -toNumber(n) }) as NumberLiteral,
    ),
    // Positive number literal
    and(
      [consume(NumberTok)],
      ([n]) => ({ type: "NumberLiteral", value: toNumber(n) }) as NumberLiteral,
    ),
    and(
      [consume(StringTok)],
      ([s]) => ({ type: "StringLiteral", value: unquote(s) }) as StringLiteral,
    ),
    and(
      [consume(True)],
      () => ({ type: "BooleanLiteral", value: true }) as BooleanLiteral,
    ),
    and(
      [consume(False)],
      () => ({ type: "BooleanLiteral", value: false }) as BooleanLiteral,
    ),
    and([consume(NullTok)], () => ({ type: "NullLiteral" }) as NullLiteral),
    ARRAY_LITERAL,
    OBJECT_LITERAL,
  ]);

  /**
   * ARRAY_ITEM -> RANGE_ITEM | EXPR
   * RANGE_ITEM -> EXPR '..' EXPR
   *
   * We attempt to parse RANGE_ITEM; if it fails, fallback to EXPR.
   */
  RANGE_ITEM.set = and(
    [EXPR, consume(DoubleDot), EXPR],
    ([start, , end]) => ({ type: "RangeLiteral", start, end }) as RangeLiteral,
  );

  ARRAY_ITEM.set = or([
    RANGE_ITEM,
    EXPR,
  ]);

  ARRAY_ELEMENTS.set = zeroOrManySep(ARRAY_ITEM, consume(Comma));

  ARRAY_LITERAL.set = and(
    [consume(LBracket), zeroOrOne(ARRAY_ELEMENTS), consume(RBracket)],
    ([, elements]) =>
      ({
        type: "ArrayLiteral",
        elements: (elements ?? []) as (Expression | RangeLiteral)[],
      }) as ArrayLiteral,
  );

  /**
   * OBJECT_LITERAL
   */
  OBJECT_PAIR.set = and(
    [
      or([consume(Identifier), consume(StringTok)]),
      consume(Colon),
      EXPR,
    ],
    ([rawKey, , value]) => {
      const key = rawKey.startsWith('"') ? unquote(rawKey) : rawKey;
      return { key, value } as ObjectProperty;
    },
  );

  OBJECT_PAIRS.set = zeroOrManySep(OBJECT_PAIR, consume(Comma));

  OBJECT_LITERAL.set = and(
    [consume(LBrace), zeroOrOne(OBJECT_PAIRS), consume(RBrace)],
    ([, props]) =>
      ({
        type: "ObjectLiteral",
        properties: (props ?? []) as ObjectProperty[],
      }) as ObjectLiteral,
  );

  /**
   * PRIMARY
   * Order: FunctionCall | Path | Literal | '(' EXPR ')'
   * (FunctionCall must come before Path to disambiguate)
   */
  PRIMARY.set = or([
    FUNCTION_CALL,
    PATH,
    LITERAL,
    and([consume(LParen), EXPR, consume(RParen)], ([, expr]) => expr),
  ]);

  /**
   * PIPE_FUNC
   * An identifier optionally followed by argument list in parentheses.
   *
   * In pipelines, bare identifiers like:
   *   expr | sum
   * or with args:
   *   expr | filter(.age > 18)
   */
  PIPE_FUNC.set = and(
    [
      consume(Identifier),
      zeroOrOne(
        and([consume(LParen), zeroOrOne(ARG_LIST), consume(RParen)]),
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

  PIPE_TAIL.set = zeroOrMany(and([consume(Pipe), PIPE_FUNC], ([, f]) => f));

  /**
   * PIPELINE: PRIMARY ('|' PIPE_FUNC)*
   * Build PipelineExpression only if stages exist.
   */
  PIPELINE.set = and([PRIMARY, PIPE_TAIL], ([base, stages]) => {
    const s = stages as PipeStage[];
    if (s.length === 0) return base as Expression;
    return {
      type: "Pipeline",
      input: base as Expression,
      stages: s,
    } as PipelineExpression;
  });

  /**
   * UNARY: 'not' PIPELINE | PIPELINE
   * (Per precedence spec, pipeline binds tighter than 'not')
   */
  UNARY.set = or([
    and(
      [consume(Not), UNARY],
      ([, arg]) =>
        ({
          type: "UnaryExpression",
          operator: "not",
          argument: arg,
        }) as UnaryExpression,
    ),
    PIPELINE,
  ]);

  /**
   * Helper to build left-associative binary expression chains.
   */
  function infixChain(
    left: Expression,
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
      left,
    );
  }

  /**
   * MULTIPLICATIVE: UNARY ( ('*' | '/' | '%') UNARY )*
   */
  MULTIPLICATIVE.set = and(
    [
      UNARY,
      zeroOrMany(
        and(
          [
            or([consume(Star), consume(Slash), consume(Percent)]),
            UNARY,
          ],
          ([op, right]) => ({ op, right }),
        ),
      ),
    ],
    ([first, rest]) =>
      infixChain(
        first as Expression,
        rest as { op: string; right: Expression }[],
      ),
  );

  /**
   * ADDITIVE (& has same precedence as + - per spec)
   * ADDITIVE: MULTIPLICATIVE (('+' | '-' | '&') MULTIPLICATIVE)*
   */
  ADDITIVE.set = and(
    [
      MULTIPLICATIVE,
      zeroOrMany(
        and(
          [
            or([consume(Plus), consume(Minus), consume(Amp)]),
            MULTIPLICATIVE,
          ],
          ([op, right]) => ({ op, right }),
        ),
      ),
    ],
    ([first, rest]) =>
      infixChain(
        first as Expression,
        rest as { op: string; right: Expression }[],
      ),
  );

  /**
   * COMPARISON: ADDITIVE ( (== != > < >= <=) ADDITIVE )*
   * If multiple chained, left associative.
   */
  COMPARISON.set = and(
    [
      ADDITIVE,
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
            ADDITIVE,
          ],
          ([op, right]) => ({ op, right }),
        ),
      ),
    ],
    ([first, rest]) =>
      infixChain(
        first as Expression,
        rest as { op: string; right: Expression }[],
      ),
  );

  /**
   * AND: COMPARISON ('and' COMPARISON)*
   */
  AND.set = and(
    [
      COMPARISON,
      zeroOrMany(and([consume(And), COMPARISON], ([, e]) => e)),
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

  /**
   * OR: AND ('or' AND)*
   */
  OR.set = and(
    [AND, zeroOrMany(and([consume(Or), AND], ([, e]) => e))],
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

  /**
   * EXPR root -> OR
   */
  EXPR.set = OR;

  /**
   * parse() entrypoint
   */
  function parseExpression(): Expression {
    const [expr] = throwIfError(and([EXPR, consume(EOF)]));
    return expr as Expression;
  }

  return { parseExpression };
}

/**
 * Parse a pure EQL query expression.
 */
export function parseQuery(input: string): Expression {
  const { parseExpression } = buildParser(input);
  return parseExpression();
}

/**
 * Parse a message template (message mode).
 *
 * Grammar (simplified):
 *   message := (text | escape | '{' expr '}')*
 * Escapes:
 *   \{  => literal {
 *   \\  => literal \
 * No nested { } — first top-level } closes an expression block.
 */
export function parseMessage(input: string): MessageTemplate {
  const parts: (TemplateTextPart | TemplateEmbedPart)[] = [];
  let i = 0;
  let buffer = "";

  function flushText() {
    if (buffer.length > 0) {
      parts.push({ kind: "text", value: buffer });
      buffer = "";
    }
  }

  while (i < input.length) {
    const ch = input[i];

    if (ch === "\\") {
      // Escape sequence
      const next = input[i + 1];
      if (next === "{" || next === "\\") {
        buffer += next;
        i += 2;
        continue;
      }
      // Unrecognized escape: treat '\' literally
      buffer += "\\";
      i++;
      continue;
    }

    if (ch === "{") {
      // Start of expression
      flushText();
      i++;
      const exprStart = i;
      let found = false;
      while (i < input.length) {
        if (input[i] === "}") {
          found = true;
          break;
        }
        if (input[i] === "{") {
          // No nesting allowed -> treat as literal '{'
          // We'll continue; the first } will still terminate expression erroneously.
          // To be strict, we could fail; spec states "No nesting".
          // Choose to treat nested { as literal text inside expression (will parse error later if invalid).
        }
        i++;
      }
      if (!found) {
        throw new Error("Unterminated expression in message template");
      }
      const exprSource = input.slice(exprStart, i).trim();
      i++; // consume '}'
      if (exprSource.length === 0) {
        // Empty embed => treat as empty string
        parts.push({ kind: "embed", expr: { type: "NullLiteral" } });
      } else {
        const expr = parseQuery(exprSource);
        parts.push({ kind: "embed", expr });
      }
      continue;
    }

    buffer += ch;
    i++;
  }

  flushText();

  return {
    type: "MessageTemplate",
    parts,
  };
}
