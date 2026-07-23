import assert from "node:assert/strict";
import { test } from "node:test";

import type { mcp } from "@gismo/sdk";

import { headingToward, stepHeadingToward, stepSpeedToward, turnAllowance } from "../src/agent/legality.js";
import { HeuristicStrategy } from "../examples/heuristic/strategy.js";

type TerrainView = mcp.StateView["terrain"][number];

const FOREST = 1;
const PLAIN = 0;
const SPEED_AHEAD_HALF = 2;

function tank(overrides: Partial<mcp.TankView> = {}): mcp.TankView {
  return {
    id: 1,
    side: 1,
    x: 0,
    y: 0,
    heading: 0,
    speed: 1,
    turretHeading: 0,
    ammo: 4,
    hitsTaken: 0,
    ...overrides,
  };
}

function view(ownTanks: mcp.TankView[], visibleTanks: mcp.TankView[] = [], terrain: TerrainView[] = []): mcp.StateView {
  return { matchId: "m1", impulse: 1, terrain, ownTanks, visibleTanks, blockhouses: [] };
}

function wantSeekCoverHeading(t: mcp.TankView, target: { x: number; y: number }): number {
  const targetHeading = headingToward(target.x - t.x, target.y - t.y, t.heading);
  const speed = stepSpeedToward(t.speed, SPEED_AHEAD_HALF);
  return stepHeadingToward(t.heading, targetHeading, turnAllowance(speed));
}

test("holds when nothing visible and no forest in range", () => {
  const t = tank({ id: 1, heading: 3, speed: 2 });
  const order = new HeuristicStrategy().decide(view([t]))[0];
  assert.equal(order.turretHold, true);
  assert.equal(order.fire, false);
  assert.equal(order.heading, t.heading);
  assert.equal(order.speed, t.speed);
});

test("engages the nearest enemy by distance", () => {
  const t = tank({ id: 1, x: 0, y: 0 });
  const near = tank({ id: 2, x: 5, y: 0 });
  const far = tank({ id: 3, x: 50, y: 0 });
  const order = new HeuristicStrategy().decide(view([t], [far, near]))[0];
  assert.equal(order.targetX, near.x);
  assert.equal(order.targetY, near.y);
});

test("nearest-enemy tie-break prefers the lowest id", () => {
  const t = tank({ id: 1, x: 0, y: 0 });
  const a = tank({ id: 5, x: 5, y: 0 });
  const b = tank({ id: 2, x: 0, y: 5 });
  const order = new HeuristicStrategy().decide(view([t], [a, b]))[0];
  assert.equal(order.targetX, b.x);
  assert.equal(order.targetY, b.y);
});

test("fires only when the turret is aligned, the target is in range, and ammo remains", () => {
  const enemy = tank({ id: 2, x: 0, y: -10 });

  const aligned = new HeuristicStrategy().decide(view([tank({ id: 1, x: 0, y: 0, turretHeading: 0, ammo: 4 })], [enemy]))[0];
  assert.equal(aligned.fire, true);

  const outOfAmmo = new HeuristicStrategy().decide(view([tank({ id: 1, x: 0, y: 0, turretHeading: 0, ammo: 0 })], [enemy]))[0];
  assert.equal(outOfAmmo.fire, false);

  const misaligned = new HeuristicStrategy().decide(view([tank({ id: 1, x: 0, y: 0, turretHeading: 4, ammo: 4 })], [enemy]))[0];
  assert.equal(misaligned.fire, false);

  const farEnemy = tank({ id: 2, x: 0, y: -1000 });
  const outOfRange = new HeuristicStrategy().decide(view([tank({ id: 1, x: 0, y: 0, turretHeading: 0, ammo: 4 })], [farEnemy]))[0];
  assert.equal(outOfRange.fire, false);
});

test("halts to steady its aim within close engagement range", () => {
  const t = tank({ id: 1, x: 0, y: 0, speed: 2 });
  const closeEnemy = tank({ id: 2, x: 5, y: 0 });
  const order = new HeuristicStrategy().decide(view([t], [closeEnemy]))[0];
  assert.equal(order.speed, stepSpeedToward(t.speed, 1));
});

test("seeks the nearest forest cell when no enemies are visible", () => {
  const t = tank({ id: 1, x: 0, y: 0 });
  const nearForest: TerrainView = { x: 3, y: 0, type: FOREST };
  const farForest: TerrainView = { x: 30, y: 0, type: FOREST };
  const plain: TerrainView = { x: 1, y: 0, type: PLAIN };
  const order = new HeuristicStrategy().decide(view([t], [], [farForest, plain, nearForest]))[0];
  assert.equal(order.turretHold, true);
  assert.equal(order.fire, false);
  assert.equal(order.heading, wantSeekCoverHeading(t, nearForest));
});

test("nearest-forest tie-break prefers lowest y then lowest x", () => {
  const t = tank({ id: 1, x: 0, y: 0 });
  const a: TerrainView = { x: 5, y: 5, type: FOREST };
  const b: TerrainView = { x: 1, y: 5, type: FOREST };
  const order = new HeuristicStrategy().decide(view([t], [], [a, b]))[0];
  assert.equal(order.heading, wantSeekCoverHeading(t, b));
});

test("holds when already standing on a forest cell", () => {
  const t = tank({ id: 1, x: 2, y: 2, heading: 5, speed: 1 });
  const here: TerrainView = { x: 2, y: 2, type: FOREST };
  const order = new HeuristicStrategy().decide(view([t], [], [here]))[0];
  assert.equal(order.turretHold, true);
  assert.equal(order.heading, t.heading);
  assert.equal(order.speed, t.speed);
});

test("decisions are deterministic for the same input", () => {
  const t = tank({ id: 1, x: 0, y: 0 });
  const enemy = tank({ id: 2, x: 10, y: 10 });
  const v = view([t], [enemy]);
  assert.deepEqual(new HeuristicStrategy().decide(v), new HeuristicStrategy().decide(v));
});
