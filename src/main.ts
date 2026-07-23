#!/usr/bin/env node
// Stub entrypoint — fork this repo and replace HoldStrategy() below with your own Strategy.
import { parseArgs } from "node:util";

import { NAME, VERSION } from "./agent/server.js";
import { serve } from "./agent/serve.js";
import { HoldStrategy } from "./agent/strategy.js";

async function main(): Promise<void> {
  const {
    values: { addr },
  } = parseArgs({ options: { addr: { type: "string", default: ":8080" } } });

  console.log(`${NAME} ${VERSION} listening on ${addr}`);
  await serve(addr as string, new HoldStrategy());
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
