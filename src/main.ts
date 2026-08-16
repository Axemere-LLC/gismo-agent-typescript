#!/usr/bin/env node
// Stub entrypoint — fork this repo and replace HoldStrategy() below with your own Strategy.
import { parseArgs } from "node:util";

import { NAME, VERSION } from "./agent/server.js";
import { defaultAddr, serve } from "./agent/serve.js";
import { HoldStrategy } from "./agent/strategy.js";

async function main(): Promise<void> {
  const {
    values: { addr },
  } = parseArgs({ options: { addr: { type: "string", default: defaultAddr(":8080") } } });

  const authKey = process.env.MCP_OUTBOUND_KEY;
  if (authKey) {
    console.log("MCP_OUTBOUND_KEY set: requiring a matching Authorization: Bearer header");
  } else {
    console.log("MCP_OUTBOUND_KEY not set: endpoint is unauthenticated");
  }

  console.log(`${NAME} ${VERSION} listening on ${addr}`);
  await serve(addr as string, new HoldStrategy(), undefined, undefined, authKey || undefined);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
