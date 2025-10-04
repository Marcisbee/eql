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

Deno.bench("eql.complex_message", { group: "parse" }, () => {
  parseMessage(
    "{users | filter(.age > 18) | map(.name) | sort}",
  );
});

Deno.bench("eql.complex_query", { group: "parse" }, () => {
  parseQuery(
    "users | filter(.age > 18) | map(.name) | sort",
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

const ast3 = parseMessage(
  "{users | filter(.age > 18) | map(.name) | sort}",
);
Deno.bench("eql.complex_query", { group: "codegen" }, () => {
  generateMessageParts(ast3);
});

const ast4 = parseQuery(
  "users | filter(.age > 18) | map(.name) | sort",
);
Deno.bench("eql.complex_query", { group: "codegen" }, () => {
  generateQueryCode(ast4);
});
