import { default as MF2 } from "npm:messageformat@2.3.0";
import { MessagePipe } from "npm:messagepipe@0.2.3";
import { MessageFormat as MFPlus } from "jsr:@marcisbee/mf@0.5.0";

import { Eql } from "./main.ts";

const customFormatters = {
  upcase: (str: string) => str.toUpperCase(),
};
const data = { salutation: "mr", user: "Test" };

// Benchmarks
Deno.bench("eql", { group: "full" }, () => {
  new Eql({ transformers: customFormatters as any }).compileMessage(
    "Hello {a} {salutation} {user|upcase}!",
  )(data);
});

Deno.bench("messagepipe@0.2.3", { group: "full" }, () => {
  MessagePipe(customFormatters).compile(
    "Hello {a} {salutation} {user|upcase}!",
  )(data);
});

Deno.bench("messageformat-plus@0.4.0", { group: "full" }, () => {
  new MFPlus("en", { customFormatters }).compile(
    "Hello {a} {salutation} {user,upcase}!",
  )(data);
});

Deno.bench("messageformat@2.3.0", { group: "full" }, () => {
  new MF2("en", { customFormatters }).compile(
    "Hello {a} {salutation} {user,upcase}!",
  )(data);
});
