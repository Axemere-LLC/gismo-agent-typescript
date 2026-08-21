// Locks each bundled strategy to a recorded set of orders for a fixed
// scenario corpus, so an edit to shared logic (e.g. holdOrders) that
// silently changes an already-shipped generation's behavior fails a test
// instead of shipping unnoticed. Mirrors gismo-agent-go's
// agent/fixtures_test.go and gismo-agent-python's tests/test_fixtures.py.
//
// Run with UPDATE_FIXTURES=1 to regenerate the golden files after an
// intentional behavior change:
//     UPDATE_FIXTURES=1 npm test
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { HeuristicStrategy } from "../examples/heuristic/strategy.js";
import { RandomStrategy } from "../examples/random/strategy.js";
import { loadScenarios, replay, type Reply } from "../src/agent/fixtures.js";
import { HoldStrategy, type Strategy } from "../src/agent/strategy.js";

// The repo root is two levels up from dist/test/ (the compiled test location).
const REPO_DIR = path.resolve(fileURLToPath(import.meta.url), "..", "..", "..");
const SCENARIOS_PATH = path.join(REPO_DIR, "fixtures", "scenarios.json");

const CASES: Array<[string, Strategy, string]> = [
  ["v1", new HoldStrategy(), path.join(REPO_DIR, "fixtures", "expected", "v1.json")],
  ["random-v1", new RandomStrategy(1), path.join(REPO_DIR, "fixtures", "expected", "random-v1.json")],
  ["heuristic-v1", new HeuristicStrategy(), path.join(REPO_DIR, "fixtures", "expected", "heuristic-v1.json")],
];

function repliesJson(replies: Reply[]): string {
  return JSON.stringify(replies, null, 2) + "\n";
}

const updateFixtures = process.env.UPDATE_FIXTURES === "1";

for (const [name, strategy, golden] of CASES) {
  test(`fixtures: ${name} replay matches its golden`, () => {
    const scenarios = loadScenarios(SCENARIOS_PATH);
    const got = repliesJson(replay(strategy, scenarios));

    if (updateFixtures) {
      writeFileSync(golden, got);
      return;
    }

    assert.ok(existsSync(golden), `${golden} does not exist (run with UPDATE_FIXTURES=1 to generate it)`);
    const want = readFileSync(golden, "utf8");
    assert.equal(got, want, `${name} replay drifted from ${golden} (run with UPDATE_FIXTURES=1 if this drift is intentional)`);
  });
}
