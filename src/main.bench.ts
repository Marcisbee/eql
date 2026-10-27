import { default as MF2 } from "npm:messageformat@2.3.0";
import { MessagePipe } from "npm:messagepipe@0.2.3";
import { MessageFormat as MFPlus } from "jsr:@marcisbee/mf@0.5.0";

import { Eql } from "./main.ts";

const customFormatters = {
  upcase: (str: string) => str.toUpperCase(),
};
const data = { salutation: "mr", user: "Test" };

// Benchmarks
Deno.bench("eql.message", { group: "full" }, () => {
  new Eql({ transformers: customFormatters as any }).compileMessage(
    "Hello {a} {salutation} {user|upcase}!",
  )(data);
});

Deno.bench("eql.query", { group: "full" }, () => {
  new Eql({ transformers: customFormatters as any }).compileQuery(
    "user|upcase",
  )(data);
});

Deno.bench("messagepipe", { group: "full" }, () => {
  MessagePipe(customFormatters).compile(
    "Hello {a} {salutation} {user|upcase}!",
  )(data);
});

Deno.bench("mf+", { group: "full" }, () => {
  new MFPlus("en", { customFormatters }).compile(
    "Hello {a} {salutation} {user,upcase}!",
  )(data);
});

Deno.bench("mf", { group: "full" }, () => {
  new MF2("en", { customFormatters }).compile(
    "Hello {a} {salutation} {user,upcase}!",
  )(data);
});

Deno.bench("eql.message", { group: "boot" }, () => {
  new Eql({ transformers: customFormatters as any });
});

Deno.bench("eql.query", { group: "boot" }, () => {
  new Eql({ transformers: customFormatters as any });
});

const eqlInstance1 = new Eql({ transformers: customFormatters as any });
Deno.bench("eql.message", { group: "compile" }, () => {
  eqlInstance1.compileMessage(
    "Hello {a} {salutation} {user|upcase}!",
  );
});

Deno.bench("eql.query", { group: "compile" }, () => {
  eqlInstance1.compileQuery(
    "user|upcase",
  );
});

const eqlInstance2 = new Eql({ transformers: customFormatters as any });
const fn1 = eqlInstance2.compileMessage(
  "Hello {a} {salutation} {user|upcase}!",
);
Deno.bench("eql.message", { group: "eval" }, () => {
  fn1(data);
});

const fn2 = eqlInstance2.compileQuery(
  "user|upcase",
);
if (fn2(data) !== "TEST") {
  throw new Error("Query benchmark must execute the transformer");
}
Deno.bench("eql.query", { group: "eval" }, () => {
  fn2(data);
});
