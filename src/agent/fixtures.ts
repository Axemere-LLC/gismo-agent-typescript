// Loads and replays the fixture scenario corpus used by the drift lock in
// test/fixtures.test.ts. Mirrors gismo-agent-go's agent/fixtures.go — the
// golden compare and regeneration flow live in the test, not here.
import { readFileSync } from "node:fs";

import type { mcp } from "@gismo2026/sdk";

import type { Strategy } from "./strategy.js";

/** One StateView input in a fixture corpus, paired with a short name identifying it in golden files. */
export interface Scenario {
  name: string;
  view: mcp.StateView;
}

/** One Scenario's recorded output: the orders a Strategy returned for it. */
export interface Reply {
  name: string;
  orders: mcp.TankOrder[];
}

/** Reads a JSON-encoded fixture corpus (a Scenario[]) from path. */
export function loadScenarios(path: string): Scenario[] {
  return JSON.parse(readFileSync(path, "utf8")) as Scenario[];
}

/**
 * Runs strategy.decide against every scenario in order and returns one
 * Reply per scenario. For a stateful Strategy (e.g. a seeded PRNG),
 * scenario order therefore affects the result — replay a fresh Strategy
 * instance against the same scenario order every time to get a
 * reproducible golden comparison.
 */
export function replay(strategy: Strategy, scenarios: Scenario[]): Reply[] {
  return scenarios.map((s) => ({ name: s.name, orders: strategy.decide(s.view) }));
}
