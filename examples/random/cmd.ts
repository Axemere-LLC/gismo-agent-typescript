#!/usr/bin/env node
// Runs the gismo-agent-typescript random reference agent: an MCP server that
// plays every own tank with a random legal order each impulse.
import { parseArgs } from "node:util";

import { NAME, VERSION } from "../../src/agent/server.js";
import { serve } from "../../src/agent/serve.js";
import { RandomStrategy } from "./strategy.js";

async function main(): Promise<void> {
  const {
    values: { addr, seed },
  } = parseArgs({
    options: {
      addr: { type: "string", default: ":8081" },
      seed: { type: "string", default: "1" },
    },
  });

  const seedNum = Number(seed);
  console.log(`${NAME} ${VERSION} random example (seed ${seedNum}) listening on ${addr}`);
  await serve(addr as string, new RandomStrategy(seedNum));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
