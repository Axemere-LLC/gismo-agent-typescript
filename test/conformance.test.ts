// Drives real gismo-agent-typescript MCP servers — the unmodified template
// and both bundled reference agents — through the fixed 3-step scenario
// (get_state -> submit_orders -> surrender) gismo-agent-go's integration
// test runs via mockreferee.Scenario, over real HTTP transport (matching
// what the referee uses in production), validating every response against
// the published MCP JSON Schema. Mirrors gismo-agent-python's
// test_conformance.py — including its schema source: both validate live
// responses against the shared gismo-contracts/mcp-schema/*.schema.json
// files (single source of truth, resolved via GISMO_CONTRACTS_DIR, default
// ../gismo-contracts), rather than this repo's embedded copies, so all three
// language templates check conformance against the same contract Go's
// schema.Registry loads. The suite skips when that checkout is absent, as
// the Python suite does.
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { Ajv2020 } from "ajv/dist/2020.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { HeuristicStrategy } from "../examples/heuristic/strategy.js";
import { RandomStrategy } from "../examples/random/strategy.js";
import { StateCache } from "../src/agent/cache.js";
import { requestListener } from "../src/agent/serve.js";
import { HoldStrategy, type Strategy } from "../src/agent/strategy.js";

// Same createRequire workaround as src/agent/validate.ts and
// gismo-sdk-typescript/test/mcp.test.ts — ajv-formats is CJS with an ESM-
// style .d.ts, which NodeNext's default-import interop retypes as the whole
// module namespace regardless of the package's own declared default export.
const require = createRequire(import.meta.url);
const addFormats: typeof import("ajv-formats").default = require("ajv-formats");

// The repo root is two levels up from dist/test/ (the compiled test location).
const REPO_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const CONTRACTS_DIR = process.env.GISMO_CONTRACTS_DIR
  ? path.resolve(process.env.GISMO_CONTRACTS_DIR)
  : path.resolve(REPO_DIR, "..", "gismo-contracts");
const SCHEMA_DIR = path.join(CONTRACTS_DIR, "mcp-schema");

function loadSchema(fileName: string): any {
  return JSON.parse(readFileSync(path.join(SCHEMA_DIR, fileName), "utf8"));
}

// Each schema file's own top-level $ref already points at its request $def;
// dropping $id (rather than reusing it across multiple compiled defs from
// the same doc) avoids Ajv's "$id already exists" collision.
function schemaRefToDef(schemaDoc: any, defName: string) {
  const { $id: _id, ...rest } = schemaDoc;
  return { ...rest, $ref: `#/$defs/${defName}` };
}

function makeValidator(): Ajv2020 {
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  return ajv;
}

const MATCH_ID = "conformance-test-match";
const IMPULSE = 1;

const SCENARIO = [
  {
    tool: "get_state",
    request: { matchId: MATCH_ID, impulse: IMPULSE, terrain: [], ownTanks: [], visibleTanks: [], blockhouses: [] },
    schemaFile: "getState.schema.json",
    defName: "StateView",
  },
  {
    tool: "submit_orders",
    request: { matchId: MATCH_ID, impulse: IMPULSE },
    schemaFile: "submitOrders.schema.json",
    defName: "SubmitOrdersResponse",
  },
  {
    tool: "surrender",
    request: { matchId: MATCH_ID },
    schemaFile: "surrender.schema.json",
    defName: "SurrenderResponse",
  },
];

/** Boots strategy's MCP server as a real HTTP listener, using the same per-request listener src/agent/serve.ts runs in production. */
async function startAgent(strategy: Strategy): Promise<{ url: string; close: () => Promise<void> }> {
  const cache = new StateCache();
  const httpServer = createServer(requestListener(strategy, cache));

  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const { port } = httpServer.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/mcp`,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

async function runScenario(url: string): Promise<void> {
  const client = new Client({ name: "gismo-agent-typescript-conformance-test", version: "test" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));

  try {
    for (const step of SCENARIO) {
      const result = await client.callTool({ name: step.tool, arguments: step.request });
      assert.notEqual(result.isError, true, `${step.tool} returned an error result: ${JSON.stringify(result)}`);

      const ajv = makeValidator();
      const validate = ajv.compile(schemaRefToDef(loadSchema(step.schemaFile), step.defName));
      assert.equal(validate(result.structuredContent), true, ajv.errorsText(validate.errors));
    }
  } finally {
    await client.close();
  }
}

const STRATEGIES: Array<[string, Strategy]> = [
  ["unmodified template (HoldStrategy)", new HoldStrategy()],
  ["random reference agent", new RandomStrategy(1)],
  ["heuristic reference agent", new HeuristicStrategy()],
];

// Skip (rather than fail) when the gismo-contracts checkout is absent, so a
// competitor who forks this template without the sibling repo still gets a
// green suite — matching gismo-agent-python's skipif on the same directory.
const contractsAvailable = existsSync(SCHEMA_DIR);
const skip = contractsAvailable
  ? false
  : `gismo-contracts not found at ${CONTRACTS_DIR} (set GISMO_CONTRACTS_DIR)`;

for (const [name, strategy] of STRATEGIES) {
  test(`conformance: ${name} passes the 3-step scenario over real HTTP`, { skip }, async () => {
    const agent = await startAgent(strategy);
    try {
      await runScenario(agent.url);
    } finally {
      await agent.close();
    }
  });
}
