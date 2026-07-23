import assert from "node:assert/strict";
import { test } from "node:test";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { buildServer, NAME, VERSION } from "../src/agent/server.js";
import { HoldStrategy } from "../src/agent/strategy.js";

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
