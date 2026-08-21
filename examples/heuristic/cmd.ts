#!/usr/bin/env node
// Runs the gismo-agent-typescript heuristic reference agent: an MCP server
// that engages the nearest visible enemy and otherwise seeks cover in the
// nearest Forest cell.
import { parseArgs } from "node:util";

import { NAME, VERSION } from "../../src/agent/server.js";
import { serveListener, versionedRequestListener, type Mount } from "../../src/agent/serve.js";
import { HeuristicStrategy } from "./strategy.js";

async function main(): Promise<void> {
  const {
    values: { addr },
  } = parseArgs({ options: { addr: { type: "string", default: ":8082" } } });

  console.log(`${NAME} ${VERSION} heuristic example listening on ${addr}`);
  const mounts: Mount[] = [{ path: "/v1", strategy: new HeuristicStrategy() }];
  await serveListener(addr as string, versionedRequestListener(mounts));
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
