import { Eql } from "./main.ts";

const eql = new Eql();
const rows = Array.from({ length: 10_000 }, (_, index) => ({
  score: index % 100,
  weight: 2,
}));
const input = { rows, user: "Ada", count: 12, price: 5 };
const querySource = "rows | filter(.score >= 50) | map(.score * .weight) | sum";
const messageSource =
  "Hello {user | upper}: {count + 1} items, total {count * price}.";
const query = eql.compileQuery(querySource);
const message = eql.compileMessage(messageSource);
if (
  query(input) !== 745000 || message(input) !== "Hello ADA: 13 items, total 60."
) {
  throw new Error("Benchmark workload did not produce its expected result");
}
export let result: unknown;

const sources = Array.from({ length: 100 }, (_, index) => `value + ${index}`);
Deno.bench("compile 100 queries (reused sources)", () => {
  result = sources.map((source) => eql.compileQuery(source));
});
let batch = 0;
Deno.bench("compile 100 queries (unique sources)", () => {
  const start = batch++ * 100;
  result = sources.map((_, offset) =>
    eql.compileQuery(`value + ${start + offset}`)
  );
});
Deno.bench("compile 100 messages (reused sources)", () => {
  result = sources.map((source) => eql.compileMessage(`Result: {${source}}`));
});
let messageBatch = 0;
Deno.bench("compile 100 messages (unique sources)", () => {
  const start = messageBatch++ * 100;
  result = sources.map((_, offset) =>
    eql.compileMessage(`Result: {value + ${start + offset}}`)
  );
});
Deno.bench("query 10000 rows", () => {
  result = query(input);
});
Deno.bench("render message", () => {
  result = message(input);
});
