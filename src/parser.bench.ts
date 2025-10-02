import { parseMessage, parseQuery } from "./parser.ts";

// Benchmarks
Deno.bench("eql.message", { group: "parse" }, () => {
  parseMessage(
    "Hello {a} {salutation} {user|upcase}!",
  );
});

Deno.bench("eql.query", { group: "parse" }, () => {
  parseQuery(
    "user|upcase",
  );
});
