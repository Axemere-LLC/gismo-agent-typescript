import type { mcp } from "@gismo/sdk";

import { headingToward, stepHeadingToward, stepSpeedToward, turnAllowance } from "../../src/agent/legality.js";
import type { Strategy } from "../../src/agent/strategy.js";

const NUM_HEADINGS = 8;
const NUM_SPEEDS = 4;
const FIRE_PROBABILITY_PERCENT = 50;

/**
 * Deterministic PRNG (mulberry32): the same seed always produces the same
 * order sequence, which is what keeps this agent reproducible for the
 * conformance harness and CI — Math.random() can't offer that.
 */
class Rng {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  private next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  intN(n: number): number {
    return Math.floor(this.next() * n);
  }

  choice<T>(items: T[]): T {
    return items[this.intN(items.length)];
  }
}

/**
 * The simplest legal Gismo player: every impulse, each own tank picks a
 * random legal heading/speed step and, if an enemy is visible, sometimes
 * fires at one. It exists to give competitors (and the conformance harness)
 * a deterministic, always-legal opponent that isn't just holding still — not
 * to play well.
 */
export class RandomStrategy implements Strategy {
  private readonly rng: Rng;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
  }

  decide(view: mcp.StateView): mcp.TankOrder[] {
    return view.ownTanks.map((tank) => this.orderFor(tank, view.visibleTanks));
  }

  private orderFor(tank: mcp.TankView, visible: mcp.TankView[]): mcp.TankOrder {
    const targetSpeed = this.rng.intN(NUM_SPEEDS);
    const speed = stepSpeedToward(tank.speed, targetSpeed);

    const targetHeading = this.rng.intN(NUM_HEADINGS);
    const heading = stepHeadingToward(tank.heading, targetHeading, turnAllowance(speed));

    const order: mcp.TankOrder = {
      tankId: tank.id,
      speed,
      heading,
      turretHold: true,
      turretHeading: 0,
      fire: false,
      targetX: 0,
      targetY: 0,
    };

    if (visible.length === 0 || this.rng.intN(100) >= FIRE_PROBABILITY_PERCENT) {
      return order;
    }

    const target = this.rng.choice(visible);
    order.turretHold = false;
    order.turretHeading = headingToward(target.x - tank.x, target.y - tank.y, tank.turretHeading);
    order.fire = true;
    order.targetX = target.x;
    order.targetY = target.y;
    return order;
  }
}
