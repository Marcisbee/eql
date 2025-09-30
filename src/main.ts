import { parseMessage, parseQuery } from "./parser.ts";
export { parseMessage, parseQuery };

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const sample = "users | filter(.age > 18) | map(.name) | sort";
  try {
    const ast = parseQuery(sample);
    console.log("EQL:", sample);
    console.log("AST:", JSON.stringify(ast, null, 2));
  } catch (e) {
    console.error("Parse error:", e);
  }
}
