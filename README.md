# EQL – Embedded Query Language

Tiny functional language for querying & transforming JSON‑like data. Safe.
Composable. Broadcast‑aware. Two modes: query + message.

## Why

- Need more than plain `a.b.c` paths, less than “let users run JS”.
- Deterministic + side‑effect free (except `now()`).
- Single consistent syntax (no aliases).

## Quick Glance

Expression examples:

```
a.b.c
users[0].age
users[input.idx].name
[1, 2, 3..5]
{ name: user.name, age: user.age }
users | filter(.age > 18) | map(.name) | sort
"hi_" & user.name & "!"
users | map(.age) + 1
(users | filter(.active) | len) > 2
```

Message mode:

```
"Hello {user.name}! You have {notifications | len} alerts."
```

## Install / Use

Create an `Eql` instance and compile via its methods. (The former standalone
`compileQuery` / `compileMessage` helpers have been removed; always go through
an instance.)

```ts
import { Eql } from "./src/compile.ts";

const eql = new Eql();

// Query (expression) mode
const q = eql.compileQuery("users | map(.age) | sum");
q({ users: [{ age: 2 }, { age: 5 }] }); // 7

// Message (template) mode
const m = eql.compileMessage("Adults: { users | filter(.age > 17) | len }");
m({ users: [{ age: 10 }, { age: 20 }] }); // "Adults: 1"

// With custom transformer
const eql2 = new Eql({
  transformers: { double: (v) => (typeof v === "number" ? v * 2 : null) },
});
const q2 = eql2.compileQuery("(value + 1) | double");
q2({ value: 5 }); // 12
```

## Core Concepts

### Paths

```
a.b.c          // dot
a[1]           // index
a[input.k]     // dynamic
users[ids]     // ids may be array of indexes or keys
```

Relative inside `filter` / `map`:

```
.    current element
..   parent element (outer filter/map)
...  climb further (undefined if beyond)
```

### Literals

```
Numbers     1  -3  4.5
Strings     "hello"
Booleans    true false
Null        null
Arrays      [1, 2, x, 3..5]
Objects     {a:1, b:user.name}
Ranges      [start..end]   // inclusive
```

### Pipelines

```
users | filter(.age > 18) | map(.name) | sort
items | map(.price * 1.2) | sum
array | map(.scores | max)
```

### Message Mode

```
"Hi {user.name}!"
"Top: {users | filter(.score > 90) | len}"
Escapes: \{  for { ,  \\ for \
```

### Operators (extended)

Arithmetic, comparison, logical all **broadcast** over arrays:

```
[1,2] + 5          => [6,7]
5 + [1,2]          => [6,7]
[1,2] + [10,20]    => [11,22]
[1,2] + [10]       => null            (length mismatch arithmetic)

[1,2,3] > 2        => [false,false,true]
[1,2] > [0,5]      => [true,false]
[1,2] > [0]        => false           (length mismatch comparison/logical)

not [true,false]   => [false,true]
"hi"&user.name     => concat (stringify non‑strings; null -> "null")
```

Invalid numeric operands → `null` (or element‑wise `null` array). Division/mod
by zero → `null`.

### Null & Errors

No throws for invalid paths/ops. Instead:

- Bad path → `undefined` flows into expression (usually `null` outcome)
- Wrong types → `null`
- Array length mismatch:
  - arithmetic → `null`
  - comparison/logical → `false`

### Transformers

Built‑ins include (abbrev):

```
filter map sort reverse first take range
sum avg min max len round
upper lower trim contains replace slice join concat
add sub mul div mod
if all any equal
is_null is_number is_string is_array is_object exists
date now diff format
(_arith _comp _logic _not)  // internal for operators
```

You can override or extend:

```ts
const eql = new Eql({
  transformers: {
    triple: (v) => (typeof v === "number" ? v * 3 : null),
  },
});
eql.compileQuery("value | triple")({ value: 4 }); // 12
```

## Mental Model

```
source  ->  parse -> AST -> generate -> "f._arith('+', i.a, 5)" -> new Function
                (pure)            (no eval of user data)
```

Generated code always references only:

- `i` : input object
- `f` : transformer library

Example generation:

```
users | filter(.age > 18) | map(.name) | sort
=> f.sort(
     f.map(
       f.filter(i.users, function(v0){return f._comp(">", v0.age, 18)}),
       function(v0){return v0.name}
     )
   )
```

## Handy Examples

```
// Ages plus one
users | map(.age + 1)

// Names of users whose first friend is over 30
users | filter(.friends.0.age > 30) | map(.name)

// Build object
{ names: users | map(.name), count: users | len }

// Dynamic index
matrix[input.row][input.col]

// Range usage
[1..(input.n + 2)]

// Nested filters with relative scopes
users | filter(.friends | filter(..age > 18) | len > 0) | map(.name)
```

Message:

```
"Adults: {users | filter(.age > 17) | len}. All: {users | map(.name) | join(\", \")}"
```

## Extending

Add a new calculation:

```ts
const eql = new Eql({
  transformers: {
    mean: (arr) =>
      Array.isArray(arr)
        ? (arr.filter((x) => typeof x === "number")
          .reduce((a, b) => a + b, 0)) /
          (arr.filter((x) => typeof x === "number").length || 1)
        : null,
  },
});

const q = eql.compileQuery("scores | mean");
q({ scores: [10, 15, 25] }); // 16.666...
```

## AST Peek

AST is a plain JSON tree:

```
{
  type: "Pipeline",
  input: { type: "Path", relative: 0, segments:[{kind:"prop", name:"users"}] },
  stages: [
    { name:"filter", args:[ { type:"BinaryExpression", ... } ] },
    { name:"map", args:[ { type:"Path", relative:1, segments:[{kind:"prop",name:"name"}]} ] },
    { name:"sort", args:[] }
  ]
}
```

You can feed this into `generateQueryCode(ast)` if you want the code string
directly (advanced use).

## Performance Notes

- One pass parse, one pass codegen.
- Helpers tuned for small overhead; broadcasting loops are direct.
- Compile once, reuse many times.

## Design Principles

- **One way** per feature; no alias clutter.
- **Fail soft** with `null` instead of exceptions.
- **No side effects** (except time).
- **Separation**: parser (AST) / codegen (JS) / runtime (transformers).
- **Predictable broadcasting** semantics.

## License

[MIT](LICENCE) &copy; [Marcis Bergmanis](https://twitter.com/marcisbee)
