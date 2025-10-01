import { parseMessage, parseQuery } from "./parser.ts";
import { Eql, EqlOptions, TransformerFn } from "./compile.ts";

export { Eql, type EqlOptions, parseMessage, parseQuery, type TransformerFn };

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const eql = new Eql({
    transformers: { double: (v) => (typeof v === "number" ? v * 2 : null) },
  });

  const query = eql.compileQuery(`if(5>3, "yes", "no")`);
  console.log(query.toString());
  console.log(query({ value: 5 }));
}
