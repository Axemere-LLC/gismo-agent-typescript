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
 * One immutable agent generation served at a fixed URL path, for use with
 * versionedRequestListener. path must start with "/" and not be the bare
 * root (e.g. "/v1"); the version label reported to the referee in the MCP
 * initialize handshake is derived from it (path with its leading "/"
 * stripped), so "/v3" reports "v3" with nothing to keep in sync by hand.
 * Mirrors agent.Mount in gismo-agent-go and gismo_agent.serve.Mount in
 * gismo-agent-python.
 */
export interface Mount {
  path: string;
  strategy: Strategy;
}

/**
 * Builds a single RequestListener that dispatches to one or more immutable
 * agent generations by URL path — the shape a fork grows into once it has
 * more than one generation registered with the platform. See
 * gismo-agent-hosting/docs/serving-multiple-versions.md.
 *
 * The MCP SDK's StreamableHTTPServerTransport ignores the request URL
 * entirely (it branches only on HTTP method), so all path dispatch here is
 * ours: both the exact path and its trailing-slash form are registered
 * against the same per-mount listener, so a client that doesn't follow
 * redirects still connects; any other path 404s. Each mount gets its own
 * StateCache (via requestListener), so generations never share match state
 * even if two mounts wrap the same Strategy instance. The returned
 * listener does not apply authentication; wrap it with bearerAuth if the
 * deployment requires one.
 */
export function versionedRequestListener(mounts: Mount[]): (req: IncomingMessage, res: ServerResponse) => void {
  if (mounts.length === 0) {
    throw new Error("gismo-agent-typescript: versionedRequestListener: no mounts given");
  }

  const listeners = new Map<string, (req: IncomingMessage, res: ServerResponse) => void>();
  for (const mount of mounts) {
    if (!mount.path.startsWith("/") || mount.path === "/") {
      throw new Error(
        `gismo-agent-typescript: versionedRequestListener: mount path ${JSON.stringify(mount.path)} must start with "/" and not be the bare root`,
      );
    }
    if (listeners.has(mount.path)) {
      throw new Error(`gismo-agent-typescript: versionedRequestListener: duplicate mount path ${JSON.stringify(mount.path)}`);
    }

    const label = mount.path.slice(1);
    const listener = requestListener(mount.strategy, new StateCache(), label);
    listeners.set(mount.path, listener);
    listeners.set(mount.path + "/", listener);
  }

  return (req, res) => {
    const pathname = new URL(req.url ?? "/", "http://placeholder").pathname;
    const listener = listeners.get(pathname);
    if (!listener) {
      res.writeHead(404).end();
      return;
    }
    listener(req, res);
  };
}

/**
 * Serves listener on addr until SIGINT/SIGTERM (or, for tests, until signal
 * aborts) — the reusable listen/shutdown half of serve, split out so
 * versionedRequestListener's dispatcher (or any other RequestListener) can
 * reuse it without going through serve's single-strategy signature.
 */
export async function serveListener(
  addr: string,
  listener: (req: IncomingMessage, res: ServerResponse) => void,
  signal?: AbortSignal,
): Promise<void> {
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
  await serveListener(addr, listener, signal);
}
