import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

import { bearerAuth } from "./auth.js";
import { StateCache } from "./cache.js";
import { buildServer } from "./server.js";
import type { Strategy } from "./strategy.js";

function parseAddr(addr: string): { host: string; port: number } {
  const idx = addr.lastIndexOf(":");
  const host = idx > 0 ? addr.slice(0, idx) : "0.0.0.0";
  const port = Number(addr.slice(idx + 1));
  return { host: host === "" ? "0.0.0.0" : host, port };
}

/**
 * Returns ":" + $PORT when PORT is set (Cloud Run/Lambda-style platforms
 * inject it), otherwise fallback — so -addr can still override when PORT is
 * unset.
 */
export function defaultAddr(fallback: string): string {
  const port = process.env.PORT;
  return port ? `:${port}` : fallback;
}

/**
 * Builds a Node HTTP request listener backed by a fresh McpServer + transport
 * per request. Required because the stateless StreamableHTTPServerTransport
 * (sessionIdGenerator: undefined) can only ever handle one HTTP request —
 * reusing it throws on the second request, which every real MCP client
 * triggers immediately via its mandatory post-initialize
 * notifications/initialized call. cache is shared across requests (and thus
 * across the McpServer instances built per request) so get_state and the
 * later submit_orders for the same matchId still see the same view. version
 * overrides the serverInfo version each of those servers reports — see
 * buildServer.
 */
export function requestListener(
  strategy: Strategy | undefined,
  cache: StateCache,
  version?: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    void (async () => {
      const mcpServer = buildServer(strategy, cache, version);
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcpServer.connect(transport);
      res.on("close", () => {
        void transport.close();
        void mcpServer.close();
      });
      await transport.handleRequest(req, res);
    })().catch((err: unknown) => {
      console.error("gismo-agent-typescript: request handling error", err);
      if (!res.headersSent) {
        res.writeHead(500).end();
      }
    });
  };
}

/**
 * Serves strategy over Streamable HTTP on addr until SIGINT/SIGTERM (or, for
 * tests, until signal aborts). version overrides the reported serverInfo
 * version — see buildServer. When authKey is given, requests must carry a
 * matching `Authorization: Bearer <authKey>` header — see bearerAuth.
 */
export async function serve(
  addr: string,
  strategy?: Strategy,
  signal?: AbortSignal,
  version?: string,
  authKey?: string,
): Promise<void> {
  const cache = new StateCache();
  let listener = requestListener(strategy, cache, version);
  if (authKey !== undefined) {
    listener = bearerAuth(authKey, listener);
  }
  const httpServer = createServer(listener);

  const { host, port } = parseAddr(addr);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(port, host, () => resolve());
  });

  await new Promise<void>((resolve) => {
    const shutdown = () => httpServer.close(() => resolve());
    signal?.addEventListener("abort", shutdown, { once: true });
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
    if (signal?.aborted) {
      shutdown();
    }
  });
}
