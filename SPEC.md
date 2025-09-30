# Embedded Query Language (EQL) Specification

## Introduction

EQL (Embedded Query Language) is a small, simple, and functional query language
designed for querying and transforming JSON-like data structures. It supports
nested data access, transformations via functions and operators, comparisons,
filtering, and two operational modes: **query mode** (evaluating a single
expression) and **message mode** (templating text with embedded expressions).
The language prioritizes minimality, with exactly one way to perform each
operation, no redundant syntax, and a focus on pure expressions without side
effects, loops, or variables (beyond implicit scoping in filters/maps).

EQL operates on JSON-compatible data: objects (key-value maps), arrays, strings,
numbers, booleans, and null. Expressions always evaluate to a single value
(primitive, array, or object). Non-existent paths or invalid operations yield
`null` (no errors are thrown).

### Key Goals

- Enable nested data queries (e.g., `a.b.c`).
- Support transformations (e.g., arithmetic, string operations).
- Allow comparisons and filtering (e.g., on arrays).
- Provide two modes: pure queries and text templating.
- Ensure simplicity: No ambiguities, custom variables, or optional features.

This specification outlines the syntax, features, grammar, examples, caveats,
and design decisions.

## Data Model

- **Root Data**: A single JSON value (object or array).
- **Types**:
  - **Object**: `{ "key": value, ... }` (keys are strings).
  - **Array**: `[value, ...]` (0-indexed; negative indices from end, e.g., `-1`
    is last).
  - **Primitives**: String (`"hello"`), number (123, 3.14), boolean
    (`true`/`false`), `null`.
- Evaluation is functional: Expressions are side-effect-free and deterministic.

## Syntax Overview

### Expressions

Expressions are the core of EQL. They can be paths, literals, functions,
operators, or pipelines, combined with parentheses `(` `)` for grouping.

### Paths

- Dot-separated for nested access: `a.b.c` or `items.0.price`.
- Dynamic: `path[expr]` where `expr` evaluates to a number (array index), string
  (object field), or array of them (multiple selection).
- Relative (in `filter`/`map`): `.field` (current element), `..field` (parent
  scope), `...field` (grandparent), etc.
- Non-existent paths: `null`.

### Literals

- String: `"hello"` (double quotes only).
- Number: `123`, `3.14`.
- Boolean: `true`, `false`.
- Null: `null`.
- Array: `[expr, expr, ...]` (e.g., `[1, "a"]`); supports ranges `start..end`
  (e.g., `[2..5]` → `[2,3,4,5]`).
- Object: `{key: expr, ...}` (e.g., `{name: "Alice", age: 30}`); keys are
  identifiers or quoted strings.

### Operators

- **Arithmetic**: `+` (add), `-` (subtract), `*` (multiply), `/` (divide), `%`
  (modulo).
  - Scalar: Standard (e.g., `1 + 2` → 3).
  - Array: Element-wise with scalar broadcast (e.g., `[1,2] + 3` → `[4,5]`);
    same-length arrays (e.g., `[1,2] + [3,4]` → `[4,6]`); mismatch → `null`.
- **Comparisons**: `==` (equal), `!=` (not equal), `>` (greater), `<` (less),
  `>=`, `<=`.
  - Scalar: Standard; strings lexicographical.
  - Array: Element-wise boolean array (e.g., `[1,2] > 1` → `[false, true]`);
    mismatch → `false`.
- **Logical**: `and`, `or` (binary), `not` (unary).
  - Scalar: Standard.
  - Array: Element-wise or broadcast (e.g., `[true,false] and true` →
    `[true,false]`); mismatch → `false`.
- **String Concatenation**: `&` (e.g., `"a" & "b"` → `"ab"`).
  - Coerces non-strings: Numbers/booleans to strings; arrays/objects to JSON
    strings.
- **Precedence**: `()` > functions/pipelines > `not` > `* / %` > `+ - &` >
  comparisons > `and` > `or`.

### Functions

Functions are `func(arg1, arg2, ...)` (parentheses required, no trailing comma).
Customizable externally (e.g., via compilation like
`compileQuery("expr", { sum: customSum })`), but built-ins include:

- **String**: `upper(str)`, `lower(str)`, `concat(str1, str2, ...)`,
  `slice(str, start, end)`, `contains(str, substr)`, `trim(str)`,
  `replace(str, old, new)`.
- **Number/Array Aggregates**: `sum(array)`, `avg(array)`, `min(array)`,
  `max(array)`, `len(array_or_str)`, `round(num, decimals)`.
- **Array Manipulation**: `sort(array)`, `reverse(array)`,
  `join(array, separator)`, `first(array)`, `slice(array, start, end)`,
  `take(array, n)`.
- **Conditional**: `if(condition, true_expr, false_expr)`.
- **Logical/Array Reducers**: `all(array)`, `any(array)`, `equal(expr1, expr2)`
  (deep equality for arrays/objects).
- **Type Checks**: `is_null(expr)`, `is_number(expr)`, `is_string(expr)`,
  `is_array(expr)`, `is_object(expr)`, `exists(path)`.
- **Date/Time**: `date(str)`, `now()`, `diff(date1, date2, unit)`,
  `format(date, pattern)` (unit: `"days"`, `"hours"`; pattern: e.g.,
  `"YYYY-MM-DD"`).
- **Arithmetic**: `add(num1, num2, ...)`, `sub(num1, num2)`,
  `mul(num1, num2, ...)`, `div(num1, num2)`, `mod(num1, num2)` (for multi-arg;
  prefer infix for binary).

Functions on invalid inputs return `null`. Aggregates skip `null` (e.g.,
`[1, null, 3] | sum` → 4).

### Pipelines

- Syntax: `expr | func(args...)` (chains left-to-right, for arrays only;
  non-array → `null`).
- Common: `array | filter(expr)` (expr uses `.field` for elements),
  `array | map(expr)` (transforms each to new array).
- Example: `users | filter(.age > 18) | map(.name) | sort`.

### Modes

- **Query Mode**: Input is a single expression; output is the evaluated value
  (JSON-stringified if complex).
- **Message Mode**: Text with `{ expr }` embeddings (e.g., "Hello {
  upper(user.name) }!").
  - Embeddings evaluate to strings (coerce: numbers as-is, booleans
    `"true"/"false"`, arrays/objects JSON-stringified, `null` → `""`).
  - Escaping: `\{` for literal `{`, `\\` for literal `\`. No nesting of `{}`.

## Grammar (Simplified BNF)

```
<expr> ::= <path> | <literal> | <function> | <unary> | <arithmetic> | <comparison> | <logical> | <concatenation> | <pipeline> | "(" <expr> ")"
<path> ::= <global_path> | <relative_path>
<global_path> ::= <ident> ("." (<ident> | <number> | "[" <expr> "]"))*
<relative_path> ::= ("."+ ) <ident> ("." (<ident> | <number> | "[" <expr> "]"))*
<literal> ::= <string> | <number> | "true" | "false" | "null" | "[" <array_elements>? "]" | "{" <object_pairs>? "}"
<array_elements> ::= <array_item> ("," <array_item>)*
<array_item> ::= <expr> | <range>
<range> ::= <expr> ".." <expr>
<object_pairs> ::= <key> ":" <expr> ("," <key> ":" <expr>)*
<key> ::= <ident> | <string>
<function> ::= <func_name> "(" (<expr> ("," <expr>)*)? ")"
<unary> ::= "not" <expr>
<arithmetic> ::= <expr> ("+" | "-" | "*" | "/" | "%") <expr>
<comparison> ::= <expr> ("==" | "!=" | ">" | "<" | ">=" | "<=") <expr>
<logical> ::= <expr> ("and" | "or") <expr>
<concatenation> ::= <expr> "&" <expr>
<pipeline> ::= <expr> ("|" <pipe_func>)*
<pipe_func> ::= <func_name>  // e.g., filter(expr), map(expr), sum, etc.
<func_name> ::= upper | lower | concat | add | sum | avg | min | max | len | sort | reverse | join | if | all | any | equal | slice | take | contains | trim | replace | is_null | is_number | is_string | is_array | is_object | exists | date | now | diff | format | first | round | sub | mul | div | mod
<message> ::= (<text> | <escape> | "{" <expr> "}")*
<escape> ::= "\{" | "\\"
<string> ::= '"' (<char> | '\"')* '"'
<number> ::= [0-9]+ ('.' [0-9]+)?
<ident> ::= [a-zA-Z_][a-zA-Z0-9_]*
<char> ::= any non-quote char
<text> ::= any char except unescaped { or \
```

- No whitespace requirements except to separate tokens.
- Case-sensitive.

## Examples

Assume data:

```
{
  "users": [
    {"name": "Alice", "age": 30, "created": "2025-09-20", "data": {"score_0": 90}},
    {"name": "Bob", "age": 17, "created": "2025-09-25", "data": {"score_0": 85}},
    {"name": "Charlie", "age": 25, "created": "2025-09-30", "data": {"score_0": 95}}
  ],
  "input": {"max_age": 20, "min": 0, "max": 2, "extra": 1, "field": "score_0"}
}
```

- **Nested Query**: `users.1.name` → `"Bob"`
- **Transformation**: `users.0.age + 5` → `35`
- **Comparison**: `users.0.age > input.max_age` → `true`
- **Filter**: `users | filter(.age > input.max_age + 5)` →
  `[{"name": "Alice", "age": 30}]`
- **Dynamic Path**: `users[input.min].data[input.field]` → `90`
- **Multiple Select**: `users[[input.min..input.max]].name` →
  `["Alice", "Bob", "Charlie"]`
- **Array Literal with Range**: `[input.min..input.max, input.extra]` →
  `[0,1,2,1]`
- **Object Literal**: `{selected: users[[0..1]].name, count: users | len}` →
  `{"selected": ["Alice", "Bob"], "count": 3}`
- **String Concat**: `"user_" & users.0.name & " (age: " & users.0.age & ")"` →
  `"user_Alice (age: 30)"`
- **Pipeline with Nesting**:
  `users | filter(.age > [18, input.max_age] | max) | map({name: .name & " Smith", score: .data["score_" & input.extra]})`
- **Date**: `users | filter(date(.created) > now() - 7 | diff("days"))` → Recent
  users
- **Type Check**: `users | filter(exists(.email) and is_number(.age))`
- **Message Mode**: "Adults: { users | filter(.age > 18) | len }. Selected: {
  users[[0..1]].name | join(\", \") }" → "Adults: 3. Selected: Alice, Bob"

## Caveats

- **Null Propagation**: Non-existent paths, invalid operations (e.g., division
  by zero, length mismatch in array ops), or type mismatches yield `null`.
  Aggregates skip `null`.
- **Coercion**: In `&`, non-strings stringify (e.g., `null & "x"` → `"nullx"`).
  Booleans in arithmetic: `true=1`, `false=0`.
- **Ranges**: Non-integers → `null`; `start > end` → `[]`.
- **Dynamic Paths**: `expr` in `[expr]` must be number/string/array thereof;
  else `null`.
- **Scoping**: Relative paths (`.`, `..`) only in `filter`/`map`; overuse (e.g.,
  `...` beyond depth) → `null`.
- **Message Mode**: No nested `{}`; embeddings coerce to strings (complex types
  JSON-stringified).
- **No Side Effects**: Purely functional; no mutations, I/O, or random values
  (except `now()`).
- **Performance**: Assumes efficient evaluation; large arrays may be slow in
  chains.
- **Dates**: Limited to ISO 8601; invalid strings → `null`.

## Design Decisions

- **One Way Principle**: To avoid confusion, e.g., only infix operators for
  binary arithmetic (prefer over `add` for readability), `&` for concat
  (distinct from `+` to avoid numeric confusion, inspired by some languages like
  VB).
- **Path-Based Iteration (`.field`)**: Simplifies filters/maps by integrating
  into paths, making it intuitive (like filesystem `.` for current); `..` for
  parents enables nesting without variables.
- **Dynamic Paths with `[expr]`**: Unified for indices/fields/multiple to
  minimize syntax; allows strings for dynamic keys, numbers for indices.
- **Array Ranges (`start..end`)**: Integrated into array literals for
  conciseness (e.g., `[2..5]`); supports variables for flexibility; no separate
  function to keep "one way."
- **Object Literals**: Added for symmetry with arrays, enabling structured
  outputs; static keys only (dynamic via paths) to avoid complexity.
- **Null for Errors**: Promotes safe, chainable queries without exceptions,
  common in data languages like JSONPath.
- **Infix Operators**: Chosen for readability in math/string ops; element-wise
  array support mimics NumPy/spreadsheets for transformations.
- **Functions Customizable Externally**: Keeps core spec simple; compilation
  allows overrides without bloating syntax.
- **Minimal Built-Ins**: Only essentials (e.g., no regex for simplicity); dates
  added for practical data queries.
- **Modes**: Query for data ops, message for templating (inspired by
  handlebars); single `{}` for simplicity, with minimal escaping.

This spec defines EQL as of September 30, 2025. For implementations, ensure
parsers handle precedence and null propagation correctly.
