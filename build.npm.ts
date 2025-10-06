#!/usr/bin/env -S deno run --allow-read --allow-write --allow-net --allow-env --allow-run

import * as dnt from "jsr:@deno/dnt";
import denojson from "./deno.json" with { type: "json" };

async function start() {
  await dnt.emptyDir("./npm");

  await dnt.build({
    entryPoints: ["./src/main.ts"],
    outDir: "./npm",
    shims: {},
    typeCheck: false,
    test: false,
    compilerOptions: {
      importHelpers: true,
      target: "ES2021",
    },
    package: {
      name: "eql-js",
      version: denojson.version,
      description: "Embedded Query Language",
      license: "MIT",
      repository: {
        type: "git",
        url: "git+https://github.com/Marcisbee/eql.git",
      },
      bugs: {
        url: "https://github.com/Marcisbee/eql/issues",
      },
    },
    declaration: "inline",

    async postBuild() {
      await Deno.copyFile("LICENSE", "npm/LICENSE");
      await Deno.copyFile("README.md", "npm/README.md");
    },
  });
}

start();
