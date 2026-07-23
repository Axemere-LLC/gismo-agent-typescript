import type { mcp } from "@gismo/sdk";

import { headingToward, stepHeadingToward, stepSpeedToward, turnAllowance, turnDistance } from "../../src/agent/legality.js";
import { holdOrders } from "../../src/agent/strategy.js";
import type { Strategy } from "../../src/agent/strategy.js";

// @gismo/sdk's mcp/index.ts doesn't re-export TerrainView (only its own
// get-state.ts module defines it) — the same gap gismo-agent-python works
// around by importing gismo.mcp.get_state directly. The TS SDK's package.json
// exports map only exposes the package root, so there's no subpath-import
// equivalent; an indexed-access type sidesteps needing the name at all.
type TerrainView = mcp.StateView["terrain"][number];

const SPEED_HALTED = 1;
const SPEED_AHEAD_HALF = 2;

const FOREST_TERRAIN = 1;

// The tank gun's documented effective range (GISMO_Specification.md's
// Weapons section: "effective range of 100 grid squares"); beyond it a shot
// has no chance of hitting a target.
const EFFECTIVE_RANGE_CELLS = 100;

// A heuristic distance, not a documented rule: inside it this strategy halts
// to steady its aim rather than continuing to close, since a stopped tank
// turns its hull twice as fast per impulse (turnAllowance).
const CLOSE_ENGAGEMENT_CELLS = 20;

/**
 * A deterministic, no-randomness reference strategy: each own tank engages
 * the nearest visible enemy, or — with none in sight — advances toward the
 * nearest Forest cell for concealment. A demonstration of what a Strategy
 * can do with the terrain and visible-tanks fields, not a tuned competitive
 * player.
 */
export class HeuristicStrategy implements Strategy {
  decide(view: mcp.StateView): mcp.TankOrder[] {
    return view.ownTanks.map((tank) => orderFor(tank, view.visibleTanks, view.terrain));
  }
}

function orderFor(tank: mcp.TankView, visible: mcp.TankView[], terrain: TerrainView[]): mcp.TankOrder {
  const enemy = nearestTank(tank, visible);
  if (enemy) {
    return engage(tank, enemy);
  }

  const cover = nearestForest(tank, terrain);
  if (cover) {
    return seekCover(tank, cover);
  }

  return holdOrders([tank])[0];
}

/**
 * Turns tank's hull and turret toward enemy, halting to steady its aim once
 * close, and fires when the turret is already aligned, the target is in
 * range, and ammo remains.
 */
function engage(tank: mcp.TankView, enemy: mcp.TankView): mcp.TankOrder {
  const dx = enemy.x - tank.x;
  const dy = enemy.y - tank.y;
  const targetHeading = headingToward(dx, dy, tank.heading);

  const desiredSpeed = distanceSquared(dx, dy) <= CLOSE_ENGAGEMENT_CELLS * CLOSE_ENGAGEMENT_CELLS ? SPEED_HALTED : SPEED_AHEAD_HALF;
  const speed = stepSpeedToward(tank.speed, desiredSpeed);
  const heading = stepHeadingToward(tank.heading, targetHeading, turnAllowance(speed));

  const aligned = turnDistance(tank.turretHeading, targetHeading) === 0;
  const inRange = distanceSquared(dx, dy) <= EFFECTIVE_RANGE_CELLS * EFFECTIVE_RANGE_CELLS;

  return {
    tankId: tank.id,
    speed,
    heading,
    turretHold: false,
    turretHeading: targetHeading,
    fire: aligned && inRange && tank.ammo > 0,
    targetX: enemy.x,
    targetY: enemy.y,
  };
}

/** Advances tank toward cover, turret held since there is nothing to aim at. */
function seekCover(tank: mcp.TankView, cover: TerrainView): mcp.TankOrder {
  const dx = cover.x - tank.x;
  const dy = cover.y - tank.y;
  if (dx === 0 && dy === 0) {
    return holdOrders([tank])[0];
  }

  const targetHeading = headingToward(dx, dy, tank.heading);
  const speed = stepSpeedToward(tank.speed, SPEED_AHEAD_HALF);
  const heading = stepHeadingToward(tank.heading, targetHeading, turnAllowance(speed));

  return {
    tankId: tank.id,
    speed,
    heading,
    turretHold: true,
    turretHeading: 0,
    fire: false,
    targetX: 0,
    targetY: 0,
  };
}

/** Closest candidate to from (squared Euclidean distance, ties broken by lowest id). */
function nearestTank(from: mcp.TankView, candidates: mcp.TankView[]): mcp.TankView | undefined {
  let best: mcp.TankView | undefined;
  let bestDist = 0;
  for (const candidate of candidates) {
    const dist = distanceSquared(candidate.x - from.x, candidate.y - from.y);
    if (!best || dist < bestDist || (dist === bestDist && candidate.id < best.id)) {
      best = candidate;
      bestDist = dist;
    }
  }
  return best;
}

/** Closest Forest cell to from (squared Euclidean distance, ties broken by lowest y then x). */
function nearestForest(from: mcp.TankView, terrain: TerrainView[]): TerrainView | undefined {
  let best: TerrainView | undefined;
  let bestDist = 0;
  for (const cell of terrain) {
    if (cell.type !== FOREST_TERRAIN) {
      continue;
    }
    const dist = distanceSquared(cell.x - from.x, cell.y - from.y);
    if (!best || dist < bestDist || (dist === bestDist && (cell.y < best.y || (cell.y === best.y && cell.x < best.x)))) {
      best = cell;
      bestDist = dist;
    }
  }
  return best;
}

function distanceSquared(dx: number, dy: number): number {
  return dx * dx + dy * dy;
}
