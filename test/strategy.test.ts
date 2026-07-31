import assert from "node:assert/strict";
import { test } from "node:test";

import type { mcp } from "@gismo2026/sdk";

import { HoldStrategy, holdOrders } from "../src/agent/strategy.js";

function tank(overrides: Partial<mcp.TankView> = {}): mcp.TankView {
  return {
    id: 1,
    side: 1,
    x: 0,
    y: 0,
    heading: 3,
    speed: 2,
    turretHeading: 5,
    ammo: 4,
    hitsTaken: 0,
    ...overrides,
  };
}

test("holdOrders returns no orders for zero tanks", () => {
  assert.deepEqual(holdOrders([]), []);
});

test("holdOrders preserves each tank's heading and speed but zeroes the turret and holds fire", () => {
  const t = tank({ id: 7, heading: 3, speed: 2, turretHeading: 5 });
  const orders = holdOrders([t]);

  assert.equal(orders.length, 1);
  assert.deepEqual(orders[0], {
    tankId: 7,
    speed: 2,
    heading: 3,
    turretHold: true,
    turretHeading: 0,
    fire: false,
    targetX: 0,
    targetY: 0,
  });
});

test("holdOrders emits one order per own tank, in order", () => {
  const tanks = [tank({ id: 1 }), tank({ id: 2 }), tank({ id: 3 })];
  const orders = holdOrders(tanks);
  assert.deepEqual(
    orders.map((o) => o.tankId),
    [1, 2, 3],
  );
});

test("HoldStrategy.decide holds every own tank and ignores visible enemies", () => {
  const t = tank({ id: 1 });
  const enemy = tank({ id: 99, side: 2 });
  const view: mcp.StateView = {
    matchId: "m1",
    impulse: 1,
    terrain: [],
    ownTanks: [t],
    visibleTanks: [enemy],
    blockhouses: [],
  };

  assert.deepEqual(new HoldStrategy().decide(view), holdOrders([t]));
});
