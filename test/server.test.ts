import assert from "node:assert/strict";
import { test } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { StateCache } from "../src/agent/cache.js";
import { buildServer, NAME, VERSION } from "../src/agent/server.js";
import { HoldStrategy } from "../src/agent/strategy.js";

/** Completes the MCP initialize handshake against server and returns the serverInfo it declared. */
async function reportedServerInfo(server: McpServer): Promise<{ name: string; version: string }> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const info = client.getServerVersion();
    assert.ok(info, "server did not report an implementation during initialize");
    return { name: info.name, version: info.version };
  } finally {
    await client.close();
    await server.close();
  }
}

test("buildServer boots with the default HoldStrategy", () => {
  const server = buildServer();
  assert.ok(server instanceof McpServer);
});

test("buildServer boots with an explicit strategy", () => {
  const server = buildServer(new HoldStrategy());
  assert.ok(server instanceof McpServer);
});

test("NAME and VERSION are non-empty", () => {
  assert.ok(NAME.length > 0);
  assert.ok(VERSION.length > 0);
});

test("buildServer reports NAME and VERSION during initialize by default", async () => {
  const info = await reportedServerInfo(buildServer());
  assert.equal(info.name, NAME);
  assert.equal(info.version, VERSION);
});

test("buildServer reports an overridden version during initialize", async () => {
  const info = await reportedServerInfo(buildServer(new HoldStrategy(), new StateCache(), "v2"));
  assert.equal(info.name, NAME);
  assert.equal(info.version, "v2");
});

test("buildServer ignores an empty version override", async () => {
  const info = await reportedServerInfo(buildServer(new HoldStrategy(), new StateCache(), ""));
  assert.equal(info.version, VERSION);
});
