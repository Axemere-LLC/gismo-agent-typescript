// Routing/isolation coverage for versionedRequestListener — mirrors
// gismo-agent-go's agent/versions_test.go and gismo-agent-python's
// tests/test_versions.py.
import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { versionedRequestListener, type Mount } from "../src/agent/serve.js";
import { HoldStrategy } from "../src/agent/strategy.js";

async function startListener(
  listener: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  const httpServer = createServer(listener);
  await new Promise<void>((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = httpServer.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    },
  };
}

async function connect(url: string): Promise<Client> {
  const client = new Client({ name: "gismo-agent-typescript-versions-test", version: "test" });
  await client.connect(new StreamableHTTPClientTransport(new URL(url)));
  return client;
}

const INVALID_MOUNT_LISTS: Array<[string, Mount[]]> = [
  ["no mounts", []],
  ["path missing leading slash", [{ path: "v1", strategy: new HoldStrategy() }]],
  ["bare root path", [{ path: "/", strategy: new HoldStrategy() }]],
  [
    "duplicate path",
    [
      { path: "/v1", strategy: new HoldStrategy() },
      { path: "/v1", strategy: new HoldStrategy() },
    ],
  ],
];

for (const [name, mounts] of INVALID_MOUNT_LISTS) {
  test(`versionedRequestListener rejects invalid mount lists: ${name}`, () => {
    assert.throws(() => versionedRequestListener(mounts));
  });
}

test("versionedRequestListener: unknown path is 404", async () => {
  const listener = versionedRequestListener([{ path: "/v1", strategy: new HoldStrategy() }]);
  const server = await startListener(listener);
  try {
    const resp = await fetch(`${server.baseUrl}/v3`, { method: "POST", body: "{}" });
    assert.equal(resp.status, 404);
  } finally {
    await server.close();
  }
});

test("versionedRequestListener: exact and trailing-slash paths both serve without a redirect", async () => {
  const listener = versionedRequestListener([{ path: "/v1", strategy: new HoldStrategy() }]);
  const server = await startListener(listener);
  try {
    for (const path of ["/v1", "/v1/"]) {
      const resp = await fetch(`${server.baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: "{}",
        redirect: "manual",
      });
      assert.ok(resp.status < 300 || resp.status >= 400, `POST ${path} = ${resp.status}, want no redirect`);
    }
  } finally {
    await server.close();
  }
});

test("versionedRequestListener: reported version label matches path", async () => {
  const listener = versionedRequestListener([
    { path: "/v1", strategy: new HoldStrategy() },
    { path: "/v3", strategy: new HoldStrategy() },
  ]);
  const server = await startListener(listener);
  try {
    for (const [path, want] of [
      ["/v1", "v1"],
      ["/v3", "v3"],
    ]) {
      const client = await connect(`${server.baseUrl}${path}`);
      try {
        const info = client.getServerVersion();
        assert.equal(info?.version, want);
      } finally {
        await client.close();
      }
    }
  } finally {
    await server.close();
  }
});

test("versionedRequestListener: mounts have independent state", async () => {
  const listener = versionedRequestListener([
    { path: "/v1", strategy: new HoldStrategy() },
    { path: "/v2", strategy: new HoldStrategy() },
  ]);
  const server = await startListener(listener);
  const matchId = "shared-match";
  try {
    const v1 = await connect(`${server.baseUrl}/v1`);
    try {
      await v1.callTool({
        name: "get_state",
        arguments: { matchId, impulse: 1, terrain: [], ownTanks: [{ id: 1, side: 0, x: 0, y: 0, heading: 0, speed: 1, turretHeading: 0, ammo: 5, hitsTaken: 0 }], visibleTanks: [], blockhouses: [] },
      });
    } finally {
      await v1.close();
    }

    // Same match ID, but the /v2 mount never saw a get_state for it: if
    // mounts shared a cache, this would return /v1's cached orders instead
    // of an empty list.
    const v2 = await connect(`${server.baseUrl}/v2`);
    try {
      const result = await v2.callTool({ name: "submit_orders", arguments: { matchId, impulse: 1 } });
      const structured = result.structuredContent as { orders: unknown[] };
      assert.deepEqual(structured.orders, []);
    } finally {
      await v2.close();
    }
  } finally {
    await server.close();
  }
});
