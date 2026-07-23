import assert from "node:assert/strict";
import { test } from "node:test";

import type { mcp } from "@gismo/sdk";

import { turnAllowance, turnDistance } from "../src/agent/legality.js";
import { RandomStrategy } from "../examples/random/strategy.js";

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

function view(ownTanks: mcp.TankView[], visibleTanks: mcp.TankView[] = []): mcp.StateView {
  return { matchId: "m1", impulse: 1, terrain: [], ownTanks, visibleTanks, blockhouses: [] };
}

test("no own tanks yields no orders", () => {
  assert.deepEqual(new RandomStrategy(1).decide(view([])), []);
});

test("every emitted order is legal, across many seeds and tank configurations", () => {
  for (let seed = 0; seed < 50; seed++) {
    const tanks = Array.from({ length: 5 }, (_, i) =>
      tank({ id: i, x: i * 3, y: -i, heading: i % 8, speed: i % 4, turretHeading: (i * 2) % 8 }),
    );
    const visible = Array.from({ length: 3 }, (_, i) => tank({ id: 100 + i, x: -i, y: i }));
    const orders = new RandomStrategy(seed).decide(view(tanks, visible));

    assert.equal(orders.length, tanks.length);
    tanks.forEach((t, i) => {
      const order = orders[i];
      assert.equal(order.tankId, t.id);
      assert.ok(order.speed >= 0 && order.speed <= 3, `speed ${order.speed} out of range`);
      assert.ok(Math.abs(order.speed - t.speed) <= 1, "speed must step by at most one");
      assert.ok(
        turnDistance(t.heading, order.heading) <= turnAllowance(order.speed),
        `heading step exceeds allowance for seed ${seed}, tank ${i}`,
      );
    });
  }
});

test("never fires when no enemies are visible", () => {
  const t = tank({ id: 1 });
  for (let seed = 0; seed < 20; seed++) {
    const order = new RandomStrategy(seed).decide(view([t], []))[0];
    assert.equal(order.fire, false);
    assert.equal(order.turretHold, true);
    assert.equal(order.turretHeading, 0);
    assert.equal(order.targetX, 0);
    assert.equal(order.targetY, 0);
  }
});

test("a fired order always targets one of the visible enemies", () => {
  const t = tank({ id: 1 });
  const enemies = [tank({ id: 2, x: 5, y: 5 }), tank({ id: 3, x: -5, y: -5 })];
  const enemyIds = new Set(enemies.map((e) => e.id));

  let firedAtLeastOnce = false;
  for (let seed = 0; seed < 100; seed++) {
    const order = new RandomStrategy(seed).decide(view([t], enemies))[0];
    if (order.fire) {
      firedAtLeastOnce = true;
      assert.ok([...enemyIds].some((id, i) => order.targetX === enemies[i].x && order.targetY === enemies[i].y));
    }
  }
  assert.ok(firedAtLeastOnce, "expected at least one seed out of 100 to fire at 50% probability");
});

test("the same seed is deterministic", () => {
  const t = tank({ id: 1 });
  const enemy = tank({ id: 2, x: 10, y: 10 });
  const v = view([t], [enemy]);
  assert.deepEqual(new RandomStrategy(42).decide(v), new RandomStrategy(42).decide(v));
});

test("different seeds can diverge", () => {
  const t = tank({ id: 1 });
  const enemy = tank({ id: 2, x: 10, y: 10 });
  const v = view([t], [enemy]);
  const outcomes = new Set(Array.from({ length: 10 }, (_, seed) => JSON.stringify(new RandomStrategy(seed).decide(v))));
  assert.ok(outcomes.size > 1, "expected at least two distinct outcomes across 10 seeds");
});
