import { parseMessage, parseQuery } from "./parser.ts";
import { Eql } from "./compile.ts";

export { Eql, parseMessage, parseQuery };

// Learn more at https://docs.deno.com/runtime/manual/examples/module_metadata#concepts
if (import.meta.main) {
  const eql = new Eql({
    transformers: { double: (v) => (typeof v === "number" ? v * 2 : null) },
  });

  const query = eql.compileQuery("(value + 1) | double");
  console.log(query.toString());
  console.log(query({ value: 5 }));
}
