import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { mcp } from "@gismo2026/sdk";
import { z } from "zod";

import { StateCache } from "./cache.js";
import { HoldStrategy, type Strategy } from "./strategy.js";
import { validateGetState, validateSubmitOrdersRequest, validateSurrenderRequest } from "./validate.js";

export const NAME = "gismo-agent-typescript";

/** This template's own version, distinct from any competitor's agent-version registered with the platform. */
export const VERSION = "0.1.0";

const tankViewSchema = z
  .object({
    id: z.number().int(),
    side: z.number().int(),
    x: z.number().int(),
    y: z.number().int(),
    heading: z.number().int(),
    speed: z.number().int(),
    turretHeading: z.number().int(),
    ammo: z.number().int(),
    hitsTaken: z.number().int(),
  })
  .strict();

const blockhouseViewSchema = z
  .object({
    side: z.number().int(),
    x: z.number().int(),
    y: z.number().int(),
    hitsTaken: z.number().int(),
  })
  .strict();

const terrainViewSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    type: z.number().int(),
  })
  .strict();

/**
 * Tool wiring for get_state / submit_orders / surrender (must match
 * gismo-agent-go's agent/server.go exactly):
 *   get_state:     cache the given StateView by matchId, echo it back unchanged.
 *   submit_orders: load the cached view for matchId, ask the strategy to decide,
 *                  falling back to an empty (never null) order list on a cache miss.
 *   surrender:     always declines — competitor agents don't surrender on their own.
 *
 * version overrides what this agent reports in serverInfo during the MCP
 * initialize handshake. Set it to the version_label the platform assigned
 * your registered agent (e.g. "v2") so the referee can tell which revision
 * played a match. An empty version is ignored, keeping the template default.
 */
export function buildServer(
  strategy: Strategy = new HoldStrategy(),
  cache: StateCache = new StateCache(),
  version: string = VERSION,
): McpServer {
  const server = new McpServer({ name: NAME, version: version === "" ? VERSION : version });

  server.registerTool(
    "get_state",
    {
      description: "Deliver the current battlefield view for a match; echoed back unchanged.",
      inputSchema: {
        matchId: z.string(),
        impulse: z.number().int(),
        terrain: z.array(terrainViewSchema),
        ownTanks: z.array(tankViewSchema),
        visibleTanks: z.array(tankViewSchema),
        blockhouses: z.array(blockhouseViewSchema),
      },
    },
    async (args) => {
      const view: mcp.StateView = { ...args };
      validateGetState(view);
      cache.store(view.matchId, view);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(view) }],
        structuredContent: view as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "submit_orders",
    {
      description: "Return this impulse's orders for the strategy's own tanks.",
      inputSchema: {
        matchId: z.string(),
        impulse: z.number().int(),
      },
    },
    async (args) => {
      validateSubmitOrdersRequest(args);
      const view = cache.load(args.matchId);
      const orders = view ? strategy.decide(view) : [];
      const response: mcp.SubmitOrdersResponse = { impulse: args.impulse, orders };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
        structuredContent: response as unknown as Record<string, unknown>,
      };
    },
  );

  server.registerTool(
    "surrender",
    {
      description: "Poll whether the agent surrenders the match now.",
      inputSchema: {
        matchId: z.string(),
      },
    },
    async (args) => {
      validateSurrenderRequest(args);
      const response: mcp.SurrenderResponse = { surrendered: false };
      return {
        content: [{ type: "text" as const, text: JSON.stringify(response) }],
        structuredContent: response as unknown as Record<string, unknown>,
      };
    },
  );

  return server;
}
