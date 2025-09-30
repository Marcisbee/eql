import { parseMessage, parseQuery } from "./parser.ts";
import { compileMessage, compileQuery, Eql } from "./compile.ts";

export { compileMessage, compileQuery, Eql, parseMessage, parseQuery };

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const sample = "users | filter(.age > 18) | map(.name) | sort";
  const compiled = compileQuery("users | map(.age) | sum");
  try {
    const ast = parseQuery(sample);
    console.log("EQL sample:", sample);
    console.log("AST:", JSON.stringify(ast, null, 2));
    console.log(
      "Compiled query result:",
      compiled({ users: [{ age: 2 }, { age: 5 }] }),
    );
  } catch (e) {
    console.error("Parse/exec error:", e);
  }
}
