import assert from "node:assert/strict";
import { test } from "node:test";

import type { mcp } from "@gismo2026/sdk";

import { StateCache } from "../src/agent/cache.js";

function view(matchId: string): mcp.StateView {
  return { matchId, impulse: 1, terrain: [], ownTanks: [], visibleTanks: [], blockhouses: [] };
}

test("load on an unknown match returns undefined", () => {
  const cache = new StateCache();
  assert.equal(cache.load("nope"), undefined);
});

test("store then load round-trips the same view", () => {
  const cache = new StateCache();
  const v = view("m1");
  cache.store(v.matchId, v);
  assert.deepEqual(cache.load("m1"), v);
});

test("store overwrites a previous entry for the same match", () => {
  const cache = new StateCache();
  cache.store("m1", view("m1"));
  const updated = { ...view("m1"), impulse: 2 };
  cache.store("m1", updated);
  assert.deepEqual(cache.load("m1"), updated);
});

test("forget removes the entry", () => {
  const cache = new StateCache();
  cache.store("m1", view("m1"));
  cache.forget("m1");
  assert.equal(cache.load("m1"), undefined);
});

test("forget on an unknown match is a no-op", () => {
  const cache = new StateCache();
  assert.doesNotThrow(() => cache.forget("nope"));
});

test("entries for different matches don't collide", () => {
  const cache = new StateCache();
  cache.store("m1", view("m1"));
  cache.store("m2", view("m2"));
  assert.deepEqual(cache.load("m1"), view("m1"));
  assert.deepEqual(cache.load("m2"), view("m2"));
});
