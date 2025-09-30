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
  _arith?: TransformerFn;
  _comp?: TransformerFn;
  _logic?: TransformerFn;
  _not?: TransformerFn;
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

/* ============================================================
 * Built-in Runtime Helpers
 * ============================================================ */

/**
 * Safe numeric conversion.
 */
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/**
 * Determine if value is an array of primitives for aggregator usage.
 */
function _isArray(v: unknown): v is unknown[] {
  return Array.isArray(v);
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
 * Ensure array semantics for arithmetic / logical broadcast if desired.
 * (Current code generator uses native JS operators; advanced array semantics
 * from the spec would require changing code generation to call helper
 * functions. This is a placeholder for future enhancement.)
 */

/**
 * Built-in transformers implementing spec semantics (best effort without
 * side effects).
 */
export function buildDefaultTransformers(): TransformerLibrary {
  const f: TransformerLibrary = {
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
      // '&' operator semantics: stringify non-strings with JSON (except null)
      function toStr(x: unknown): string {
        if (x === null) return "null";
        if (x === undefined) return "null";
        if (typeof x === "string") return x;
        if (typeof x === "number" || typeof x === "boolean") return String(x);
        try {
          return JSON.stringify(x);
        } catch {
          return "null";
        }
      }
      return toStr(a) + toStr(b);
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
    concatstr(...parts: unknown[]): unknown {
      // Non-spec convenience (not used by code generator)
      return parts.map((p) => (p == null ? "" : String(p))).join("");
    },

    // --- Aggregates / numeric ---
    sum(arr: unknown): unknown {
      if (!Array.isArray(arr)) return null;
      let total = 0;
      let any = false;
      for (const v of arr) {
        const num = toNumber(v);
        if (num !== null) {
          total += num;
          any = true;
        }
      }
      return any ? total : 0;
    },
    avg(arr: unknown): unknown {
      if (!Array.isArray(arr)) return null;
      let total = 0;
      let count = 0;
      for (const v of arr) {
        const num = toNumber(v);
        if (num !== null) {
          total += num;
          count++;
        }
      }
      return count > 0 ? total / count : null;
    },
    min(arr: unknown): unknown {
      if (!Array.isArray(arr)) return null;
      let result: number | null = null;
      for (const v of arr) {
        const num = toNumber(v);
        if (num !== null) {
          result = result === null ? num : Math.min(result, num);
        }
      }
      return result;
    },
    max(arr: unknown): unknown {
      if (!Array.isArray(arr)) return null;
      let result: number | null = null;
      for (const v of arr) {
        const num = toNumber(v);
        if (num !== null) {
          result = result === null ? num : Math.max(result, num);
        }
      }
      return result;
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
      if (!Array.isArray(arr)) return null;
      for (const v of arr) {
        if (!v) return false;
      }
      return true;
    },
    any(arr: unknown): unknown {
      if (!Array.isArray(arr)) return null;
      for (const v of arr) {
        if (v) return true;
      }
      return false;
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
      return v === null || v === undefined;
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
      return v !== null && v !== undefined;
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
      // Very small pattern support
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
  };

  // Attach extended operator helpers (only if not already supplied by user overrides)
  if (!f._arith) {
    f._arith = (...args: unknown[]): unknown => {
      const [op, a, b] = args as [string, unknown, unknown];
      const toNum = (v: unknown): number | null => {
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (typeof v === "boolean") return v ? 1 : 0;
        return null;
      };
      const scalar = (x: unknown, y: unknown): unknown => {
        const nx = toNum(x);
        const ny = toNum(y);
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
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return null;
        return a.map((v, i) => scalar(v, (b as unknown[])[i]));
      }
      if (Array.isArray(a) && !Array.isArray(b)) {
        return a.map((v) => scalar(v, b));
      }
      if (!Array.isArray(a) && Array.isArray(b)) {
        return (b as unknown[]).map((v) => scalar(a, v));
      }
      return scalar(a, b);
    };
  }
  if (!f._comp) {
    f._comp = (...args: unknown[]): unknown => {
      const [op, a, b] = args as [string, unknown, unknown];
      const cmp = (x: unknown, y: unknown): boolean => {
        switch (op) {
          case "==":
            return JSON.stringify(x) === JSON.stringify(y);
          case "!=":
            return JSON.stringify(x) !== JSON.stringify(y);
          case ">":
            return (x as any) > (y as any);
            // deno-lint-ignore no-explicit-any
          case "<":
            return (x as any) < (y as any);
            // deno-lint-ignore no-explicit-any
          case ">=":
            return (x as any) >= (y as any);
            // deno-lint-ignore no-explicit-any
          case "<=":
            return (x as any) <= (y as any);
          default:
            return false;
        }
      };
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.map((v, i) => cmp(v, (b as unknown[])[i]));
      }
      if (Array.isArray(a) && !Array.isArray(b)) {
        return a.map((v) => cmp(v, b));
      }
      if (!Array.isArray(a) && Array.isArray(b)) {
        return (b as unknown[]).map((v) => cmp(a, v));
      }
      return cmp(a, b);
    };
  }
  if (!f._logic) {
    f._logic = (...args: unknown[]): unknown => {
      const [rawOp, a, b] = args as ["and" | "or", unknown, unknown];
      const op = rawOp === "and" ? "and" : "or";
      const logic = (x: unknown, y: unknown): boolean =>
        op === "and" ? !!x && !!y : !!x || !!y;
      if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;
        return a.map((v, i) => logic(v, (b as unknown[])[i]));
      }
      if (Array.isArray(a) && !Array.isArray(b)) {
        return a.map((v) => logic(v, b));
      }
      if (!Array.isArray(a) && Array.isArray(b)) {
        return (b as unknown[]).map((v) => logic(a, v));
      }
      return logic(a, b);
    };
  }
  if (!f._not) {
    f._not = (...args: unknown[]): unknown => {
      const [x] = args;
      if (Array.isArray(x)) return x.map((v) => !v);
      return !x;
    };
  }
  return f;
}

/* ============================================================
 * Compilation Helpers
 * ============================================================ */

/**
 * Attach a custom toString implementation to the compiled function.
 */
function attachFunctionMetadata<T extends Function>(
  fn: T,
  meta: {
    code: string;
    ast: unknown;
    source: string;
  },
): T {
  Object.defineProperties(fn, {
    ast: { value: meta.ast, enumerable: false },
    source: { value: meta.source, enumerable: false },
    toString: {
      value: function () {
        return meta.code;
      },
      enumerable: false,
    },
  });
  return fn;
}

/**
 * Build a safe execution wrapper.
 */
function buildQueryExecutor(
  jsExpr: string,
  lib: TransformerLibrary,
): (i: unknown) => unknown {
  // Wrap in try/catch to yield null on runtime errors.
  // eslint-disable-next-line no-new-func
  const fn = new Function(
    "f",
    `return function(i){
      try {
        return (${jsExpr});
      } catch(_e) {
        return null;
      }
    };`,
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
  // We'll define a helper inside the generated function for coercion.
  const concatCode = pieces.map((p) =>
    p.isExpr ? `__parts.push(__coerce(${p.code}));` : `__parts.push(${p.code});`
  ).join("\n");

  const full = `
    return function(i){
      const __parts = [];
      function __coerce(v){
        if(v===null||v===undefined) return "";
        const t = typeof v;
        if(t==="string") return v;
        if(t==="number") return Number.isFinite(v) ? String(v) : "";
        if(t==="boolean") return v ? "true":"false";
        try { return JSON.stringify(v); } catch { return ""; }
      }
      try {
        ${concatCode}
        return __parts.join("");
      } catch(_e) {
        return "";
      }
    };
  `;
  // eslint-disable-next-line no-new-func
  const fn = new Function("f", full)(lib) as (i: unknown) => string;
  return fn;
}

/* ============================================================
 * Public Compile Functions
 * ============================================================ */

/**
 * Compile a query (expression mode) into an executable function.
 *
 * @param source EQL query source.
 * @param transformers (optional) additional / overriding transformers.
 * @returns compiled function(input)
 */
/* Removed initial compileQuery (basic semantics) in favor of extended operator version defined later */

/**
 * Compile a message template into an executable function returning a string.
 *
 * @param source Template source.
 * @param transformers Optional additional/overriding transformers.
 * @returns compiled message function(input) => string
 */
/* Removed initial compileMessage (basic semantics) in favor of extended operator version defined later */

/* ============================================================
 * Eql Class (Instance API)
 * ============================================================ */

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
    this._transformers = Object.assign(
      buildDefaultTransformers(),
      options?.transformers ?? {},
    );
  }

  // (methods added via prototype patch & interface merge below)

  /**
   * Static convenience compile (query).
   */
  static compileQuery(
    source: string,
    transformers?: TransformerLibrary,
  ): CompiledQuery {
    return compileQuery(source, transformers);
  }

  /**
   * Static convenience compile (message).
   */
  static compileMessage(
    source: string,
    transformers?: TransformerLibrary,
  ): CompiledMessage {
    return compileMessage(source, transformers);
  }
}

/* ============================================================
 * Example (commented)
 * ============================================================
 *
 * const eql = new Eql({
 *   transformers: {
 *     sum(array) { ...override... },
 *   },
 * });
 *
 * const q = eql.compileQuery("users | map(.age) | sum");
 * const result = q({ users: [{age:2},{age:5}] });
 *
 * const msg = eql.compileMessage("Ages: { users | map(.age) | join(\",\") }");
 * console.log(msg({ users:[{age:2},{age:5}] }));
 */

/* ============================================================
 * Enhanced Array / Logical / Comparison Semantics
 * ============================================================
 *
 * We add a custom code generator for compileQuery/compileMessage that emits
 * helper calls (f._arith / f._comp / f._logic / f._not) instead of relying
 * on native JS operators so we can implement:
 *  - Arithmetic: element-wise with scalar broadcast (+ - * / %)
 *    * array op array (same length) => element-wise
 *    * array op scalar OR scalar op array => broadcast scalar
 *    * length mismatch => null
 *  - Comparisons (== != > < >= <=):
 *    * element-wise / broadcast producing boolean arrays
 *    * length mismatch => false
 *  - Logical (and / or):
 *    * element-wise / broadcast boolean logic
 *    * length mismatch => false
 *  - not:
 *    * array => element-wise negation
 *    * scalar => boolean negation
 *
 * Existing string concatenation (&) keeps using f.concat.
 * Other parts (range, filter/map pipelines, dynamic paths) are
 * regenerated here (mirroring parser.ts approach) so new semantics
 * apply uniformly.
 *
 * NOTE:
 *  We redefine compileQuery / compileMessage below; earlier exports remain
 *  but will be shadowed by these updated definitions.
 */

/**
 * Install extended operator helpers onto a transformer library if absent.
 */
// ensureExtendedOperators removed: operator helpers now always present via buildDefaultTransformers()

// Legacy inline code generation removed (migrated to codegen.ts)

/**
 * Redefined compileQuery with extended operators.
 */
export function compileQuery(
  source: string,
  transformers?: TransformerLibrary,
): CompiledQuery {
  const ast = parseQuery(source);
  const lib = Object.assign(buildDefaultTransformers(), transformers ?? {});
  const jsExpr = generateQueryCode(ast as any);
  const exec = buildQueryExecutor(jsExpr, lib) as CompiledQuery;
  return attachFunctionMetadata(exec, { code: jsExpr, ast, source });
}

/**
 * Redefined compileMessage so embedded expressions also use extended semantics.
 */

// Declare instance method types (merged declaration) so prototype patch is typed.
export interface Eql {
  compileQuery(source: string): CompiledQuery;
  compileMessage(source: string): CompiledMessage;
}
export function compileMessage(
  source: string,
  transformers?: TransformerLibrary,
): CompiledMessage {
  const tpl = parseMessage(source);
  const lib = Object.assign(buildDefaultTransformers(), transformers ?? {});
  const pieces = generateMessageParts(tpl as any);
  const exec = buildMessageExecutor(pieces, lib) as CompiledMessage;
  const synthetic = pieces.map((p) => p.isExpr ? `(${p.code})` : p.code).join(
    " + ",
  );
  return attachFunctionMetadata(exec, { code: synthetic, ast: tpl, source });
}

/**
 * Extend Eql instance methods to use new compile functions.
 */
Eql.prototype.compileQuery = function (
  this: Eql,
  source: string,
): CompiledQuery {
  const ast = parseQuery(source);
  const jsExpr = generateQueryCode(ast as any);
  const exec = buildQueryExecutor(jsExpr, this._transformers) as CompiledQuery;
  return attachFunctionMetadata(exec, { code: jsExpr, ast, source });
};

Eql.prototype.compileMessage = function (
  this: Eql,
  source: string,
): CompiledMessage {
  const tpl = parseMessage(source);
  const pieces = generateMessageParts(tpl as any);
  const exec = buildMessageExecutor(
    pieces,
    this._transformers,
  ) as CompiledMessage;
  const synthetic = pieces.map((p) => p.isExpr ? `(${p.code})` : p.code).join(
    " + ",
  );
  return attachFunctionMetadata(exec, { code: synthetic, ast: tpl, source });
};
