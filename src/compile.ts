/**
 * EQL Compiler
 *
 * Flow:
 *   parser.ts  -> AST
 *   codegen.ts -> JS expression strings
 *   compile.ts -> runtime helpers + wrapping into executable Functions
 */
import { parseMessage, parseQuery } from "./parser.ts";
import { generateMessageParts, generateQueryCode } from "./codegen.ts";

/** Transformer function signature (avoid `any`). */
export type TransformerFn = (...args: unknown[]) => unknown;

/** Runtime transformer library map. */
export interface TransformerLibrary {
  [name: string]: TransformerFn | undefined;
}

/** Options for Eql constructor. */
export interface EqlOptions {
  transformers?: TransformerLibrary;
}

/** Compiled query function interface. */
export interface CompiledQuery {
  (input: unknown): unknown;
  ast: unknown;
  source: string;
  toString(): string;
}

/** Compiled message function interface. */
export interface CompiledMessage {
  (input: unknown): string;
  ast: unknown;
  source: string;
  toString(): string;
}

/**
 * Safe numeric conversion.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/**
 * Deep equality (simple; JSON stringify fallback for objects).
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a && b && typeof a === "object" && typeof b === "object") {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * Coerce value to string for message embeddings (per spec).
 */
function _coerceMessageValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = typeof v;
  if (t === "string") return v as string;
  if (t === "number") return Number.isFinite(v as number) ? String(v) : "";
  if (t === "boolean") return (v as boolean) ? "true" : "false";
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}

/**
 * Coercion specifically for concat semantics (null/undefined => 'null').
 */
function coerceForConcat(v: unknown): string {
  if (v === null || v === undefined) return "null";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return "null";
  }
}

/**
 * Broadcast binary operation across scalar/array combinations.
 * mismatchValue is returned when both are arrays of differing length.
 */
function broadcastBinary(
  a: unknown,
  b: unknown,
  fn: (x: unknown, y: unknown) => unknown,
  mismatchValue: unknown,
): unknown {
  const aArr = Array.isArray(a);
  const bArr = Array.isArray(b);
  if (aArr && bArr) {
    const ax = a as unknown[];
    const bx = b as unknown[];
    if (ax.length !== bx.length) return mismatchValue;
    return ax.map((v, i) => fn(v, bx[i]));
  }
  if (aArr) return (a as unknown[]).map((v) => fn(v, b));
  if (bArr) return (b as unknown[]).map((v) => fn(a, v));
  return fn(a, b);
}

/**
 * Comparison helper using deepEqual for equality semantics.
 */
function compareValues(op: string, a: unknown, b: unknown): boolean {
  switch (op) {
    case "==":
      return deepEqual(a, b);
    case "!=":
      return !deepEqual(a, b);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      const an = toNumber(a);
      const bn = toNumber(b);
      const left: unknown = (an !== null && bn !== null) ? an : a as unknown;
      const right: unknown = (an !== null && bn !== null) ? bn : b as unknown;
      // Fallback to < and > JavaScript semantics.
      switch (op) {
        case ">":
          // deno-lint-ignore no-explicit-any
          return (left as any) > (right as any);
        case "<":
          // deno-lint-ignore no-explicit-any
          return (left as any) < (right as any);
        case ">=":
          // deno-lint-ignore no-explicit-any
          return (left as any) >= (right as any);
        case "<=":
          // deno-lint-ignore no-explicit-any
          return (left as any) <= (right as any);
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * Boolean reducers.
 */
function boolReduce(arr: unknown, mode: "all" | "any"): unknown {
  if (!Array.isArray(arr)) return null;
  if (mode === "all") {
    for (const v of arr) {
      if (!v) return false;
    }
    return true;
  }
  for (const v of arr) {
    if (v) return true;
  }
  return false;
}

/**
 * Iterate numeric values; invokes fn for each successfully coerced number.
 */
function eachNumeric(
  arr: unknown,
  fn: (n: number) => void,
): { any: boolean } | null {
  if (!Array.isArray(arr)) return null;
  let any = false;
  for (const v of arr) {
    const n = toNumber(v);
    if (n !== null) {
      any = true;
      fn(n);
    }
  }
  return { any };
}

/**
 * Built-in transformers implementing spec semantics.
 */
const defaultTransformers: TransformerLibrary = {
  // --- Core pipeline helpers (referenced by code generator) ---
  filter: ((...args: unknown[]) => {
    const [arr, predicate] = args;
    if (!Array.isArray(arr) || typeof predicate !== "function") return null;
    const out: unknown[] = [];
    for (const el of arr) {
      let keep = false;
      try {
        keep = !!(predicate as Function)(el);
      } catch {
        keep = false;
      }
      if (keep) out.push(el);
    }
    return out;
  }) as TransformerFn,
  map: ((...args: unknown[]) => {
    const [arr, mapper] = args;
    if (!Array.isArray(arr) || typeof mapper !== "function") return null;
    const out: unknown[] = [];
    for (const el of arr) {
      try {
        out.push((mapper as Function)(el));
      } catch {
        out.push(null);
      }
    }
    return out;
  }) as TransformerFn,
  sort(arr: unknown): unknown {
    if (!Array.isArray(arr)) return null;
    return [...arr].sort();
  },
  reverse(arr: unknown): unknown {
    if (!Array.isArray(arr)) return null;
    return [...arr].reverse();
  },
  first(arr: unknown): unknown {
    if (!Array.isArray(arr)) return null;
    return arr.length > 0 ? arr[0] : null;
  },
  range(start: unknown, end: unknown): unknown {
    const sNum = toNumber(start);
    const eNum = toNumber(end);
    if (sNum === null || eNum === null) return null;
    if (!Number.isInteger(sNum) || !Number.isInteger(eNum)) return null;
    if (sNum > eNum) return [];
    const out: number[] = [];
    for (let n = sNum; n <= eNum; n++) out.push(n);
    return out;
  },
  concat(a: unknown, b: unknown): unknown {
    return coerceForConcat(a) + coerceForConcat(b);
  },

  // --- String functions ---
  upper(v: unknown): unknown {
    return typeof v === "string" ? v.toUpperCase() : null;
  },
  lower(v: unknown): unknown {
    return typeof v === "string" ? v.toLowerCase() : null;
  },
  trim(v: unknown): unknown {
    return typeof v === "string" ? v.trim() : null;
  },
  contains(str: unknown, substr: unknown): unknown {
    return (typeof str === "string" && typeof substr === "string")
      ? str.includes(substr)
      : null;
  },
  replace(str: unknown, oldSub: unknown, newSub: unknown): unknown {
    if (
      typeof str === "string" && typeof oldSub === "string" &&
      typeof newSub === "string"
    ) {
      return str.split(oldSub).join(newSub);
    }
    return null;
  },
  slice(value: unknown, start: unknown, end: unknown): unknown {
    const s = toNumber(start) ?? 0;
    const e = toNumber(end) ?? undefined;
    if (Array.isArray(value)) return value.slice(s, e);
    if (typeof value === "string") return value.slice(s, e);
    return null;
  },
  join(arr: unknown, sep: unknown): unknown {
    if (!Array.isArray(arr)) return null;
    return arr.map((x) => (x == null ? "" : String(x))).join(
      typeof sep === "string" ? sep : ", ",
    );
  },

  // --- Aggregates / numeric ---
  sum(arr: unknown): unknown {
    let total = 0;
    const iter = eachNumeric(arr, (n) => {
      total += n;
    });
    if (iter === null) return null;
    return iter.any ? total : 0;
  },
  avg(arr: unknown): unknown {
    let total = 0;
    let count = 0;
    const iter = eachNumeric(arr, (n) => {
      total += n;
      count++;
    });
    if (iter === null) return null;
    return count > 0 ? total / count : null;
  },
  min(arr: unknown): unknown {
    let m: number | null = null;
    const iter = eachNumeric(arr, (n) => {
      m = m === null ? n : Math.min(m, n);
    });
    if (iter === null) return null;
    return m;
  },
  max(arr: unknown): unknown {
    let m: number | null = null;
    const iter = eachNumeric(arr, (n) => {
      m = m === null ? n : Math.max(m, n);
    });
    if (iter === null) return null;
    return m;
  },
  len(v: unknown): unknown {
    if (Array.isArray(v) || typeof v === "string") return v.length;
    if (v && typeof v === "object") {
      try {
        return Object.keys(v as Record<string, unknown>).length;
      } catch {
        return null;
      }
    }
    return null;
  },
  take(arr: unknown, n: unknown): unknown {
    if (!Array.isArray(arr)) return null;
    const count = toNumber(n);
    if (count === null) return null;
    return arr.slice(0, count);
  },
  round(num: unknown, decimals: unknown): unknown {
    const n = toNumber(num);
    if (n === null) return null;
    const d = toNumber(decimals) ?? 0;
    const m = Math.pow(10, d);
    return Math.round(n * m) / m;
  },

  // --- Arithmetic function alternatives ---
  add(...nums: unknown[]): unknown {
    let total = 0;
    for (const v of nums) {
      const n = toNumber(v);
      if (n === null) return null;
      total += n;
    }
    return total;
  },
  sub(a: unknown, b: unknown): unknown {
    const n1 = toNumber(a);
    const n2 = toNumber(b);
    if (n1 === null || n2 === null) return null;
    return n1 - n2;
  },
  mul(...nums: unknown[]): unknown {
    let prod = 1;
    for (const v of nums) {
      const n = toNumber(v);
      if (n === null) return null;
      prod *= n;
    }
    return prod;
  },
  div(a: unknown, b: unknown): unknown {
    const n1 = toNumber(a);
    const n2 = toNumber(b);
    if (n1 === null || n2 === null || n2 === 0) return null;
    return n1 / n2;
  },
  mod(a: unknown, b: unknown): unknown {
    const n1 = toNumber(a);
    const n2 = toNumber(b);
    if (n1 === null || n2 === null || n2 === 0) return null;
    return n1 % n2;
  },

  // --- Logical / array reducers ---
  all(arr: unknown): unknown {
    return boolReduce(arr, "all");
  },
  any(arr: unknown): unknown {
    return boolReduce(arr, "any");
  },
  equal(a: unknown, b: unknown): unknown {
    return deepEqual(a, b);
  },

  // --- Conditionals ---
  if(cond: unknown, t: unknown, f: unknown): unknown {
    return cond ? t : f;
  },

  // --- Type / existence checks ---
  is_null(v: unknown): unknown {
    return v == null;
  },
  is_number(v: unknown): unknown {
    return typeof v === "number" && Number.isFinite(v);
  },
  is_string(v: unknown): unknown {
    return typeof v === "string";
  },
  is_array(v: unknown): unknown {
    return Array.isArray(v);
  },
  is_object(v: unknown): unknown {
    return !!v && typeof v === "object" && !Array.isArray(v);
  },
  exists(v: unknown): unknown {
    return v != null;
  },

  // --- Date / time (minimal) ---
  date(v: unknown): unknown {
    if (typeof v === "string") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    }
    return null;
  },
  now(): unknown {
    return new Date();
  },
  diff(a: unknown, b: unknown, unit: unknown): unknown {
    if (!(a instanceof Date) || !(b instanceof Date)) return null;
    const ms = a.getTime() - b.getTime();
    switch (unit) {
      case "days":
        return ms / 86400000;
      case "hours":
        return ms / 3600000;
      default:
        return ms;
    }
  },
  format(d: unknown, pattern: unknown): unknown {
    if (!(d instanceof Date)) return null;
    if (typeof pattern !== "string") return null;
    const yyyy = d.getUTCFullYear().toString().padStart(4, "0");
    const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = d.getUTCDate().toString().padStart(2, "0");
    const HH = d.getUTCHours().toString().padStart(2, "0");
    const MM = d.getUTCMinutes().toString().padStart(2, "0");
    const SS = d.getUTCSeconds().toString().padStart(2, "0");
    return pattern
      .replace(/YYYY/g, yyyy)
      .replace(/MM/g, mm)
      .replace(/DD/g, dd)
      .replace(/HH/g, HH)
      .replace(/mm/g, MM)
      .replace(/ss/g, SS);
  },

  // Builtin helpers for codegen (not part of public API)
  _arith(...args: unknown[]): unknown {
    const [op, a, b] = args as [string, unknown, unknown];
    const scalar = (x: unknown, y: unknown): unknown => {
      const nx = toNumber(x);
      const ny = toNumber(y);
      if (nx === null || ny === null) return null;
      switch (op) {
        case "+":
          return nx + ny;
        case "-":
          return nx - ny;
        case "*":
          return nx * ny;
        case "/":
          return ny === 0 ? null : nx / ny;
        case "%":
          return ny === 0 ? null : nx % ny;
        default:
          return null;
      }
    };
    return broadcastBinary(a, b, scalar, null);
  },
  _comp(...args: unknown[]): unknown {
    const [op, a, b] = args as [string, unknown, unknown];
    const scalar = (x: unknown, y: unknown): boolean => compareValues(op, x, y);
    return broadcastBinary(a, b, scalar, false);
  },
  _logic(...args: unknown[]): unknown {
    const [rawOp, a, b] = args as ["and" | "or", unknown, unknown];
    const op = rawOp === "and" ? "and" : "or";
    const scalar = (x: unknown, y: unknown): boolean =>
      op === "and" ? !!x && !!y : !!x || !!y;
    return broadcastBinary(a, b, scalar, false);
  },
  _not(...args: unknown[]): unknown {
    const [x] = args;
    if (Array.isArray(x)) return x.map((v) => !v);
    return !x;
  },
};

/**
 * Build a safe execution wrapper.
 */
function buildQueryExecutor(
  jsExpr: string,
  lib: TransformerLibrary,
): (i: unknown) => unknown {
  // Wrap in try/catch to yield null on runtime errors.
  const fn = new Function(
    "f",
    `return function(i){try{return(${jsExpr});}catch(_e){return null;}};`,
  )(lib) as (i: unknown) => unknown;
  return fn;
}

/**
 * Build a message executor from concatenation logic.
 */
function buildMessageExecutor(
  pieces: { code: string; isExpr: boolean }[],
  lib: TransformerLibrary,
): (i: unknown) => string {
  // Use shared _coerceMessageValue helper (passed into generated function).
  const parts = pieces.map((p) =>
    p.isExpr ? `__coerce(${p.code})` : `${p.code}`
  );
  // Build a direct concatenation expression (avoid using Array.join).
  const expr = parts.length === 0 ? '""' : '"" + (' + parts.join(" + ") + ")";
  const full = "return function(i){try{return " + expr +
    ';}catch(_e){return "";}};';
  return new Function("f", "__coerce", full)(lib, _coerceMessageValue) as (
    i: unknown,
  ) => string;
}

/**
 * Eql class provides a reusable instance with a shared transformer
 * library (built-ins + user supplied overrides).
 */
export class Eql {
  protected readonly _transformers: TransformerLibrary;

  /**
   * Construct a new Eql instance.
   */
  constructor(options?: EqlOptions) {
    this._transformers = {
      ...defaultTransformers,
      ...(options?.transformers ?? {}),
    };
  }

  /**
   * Instance compileQuery using this instance's transformers.
   */
  compileQuery(source: string): CompiledQuery {
    const ast = parseQuery(source);
    const jsExpr = generateQueryCode(ast);
    return buildQueryExecutor(
      jsExpr,
      this._transformers,
    ) as CompiledQuery;
  }

  /**
   * Instance compileMessage using this instance's transformers.
   */
  compileMessage(source: string): CompiledMessage {
    const tpl = parseMessage(source);
    const pieces = generateMessageParts(tpl);
    return buildMessageExecutor(
      pieces,
      this._transformers,
    ) as CompiledMessage;
  }
}
