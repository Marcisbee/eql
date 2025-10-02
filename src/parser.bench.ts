import { parseMessage, parseQuery } from "./parser.ts";
import { generateMessageParts, generateQueryCode } from "./codegen.ts";

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

const ast1 = parseMessage(
  "Hello {a} {salutation} {user|upcase}!",
);
Deno.bench("eql.message", { group: "codegen" }, () => {
  generateMessageParts(ast1);
});

const ast2 = parseQuery(
  "user|upcase",
);
Deno.bench("eql.query", { group: "codegen" }, () => {
  generateQueryCode(ast2);
});
