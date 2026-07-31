import type { mcp } from "@gismo2026/sdk";

/**
 * The single hook a competitor implements: given the agent's current view
 * of the battlefield for a match, decide what orders to submit for the
 * current impulse. Everything else — the MCP server, the match-ID-scoped
 * state cache, wire encoding/decoding — is handled by this package.
 */
export interface Strategy {
  /**
   * Returns the orders to submit for view's impulse. May return an order
   * for any subset of view.ownTanks (or none); a tank with no order simply
   * holds its current heading/speed and does not fire (gismo-platform's
   * referee applies this default, since agent orders are untrusted input
   * it validates rather than corrects).
   */
  decide(view: mcp.StateView): mcp.TankOrder[];
}

/**
 * The default, always-legal strategy: every own tank keeps its current
 * heading and speed and holds its turret, firing at nothing. It is what the
 * unmodified template plays, so a competitor who hasn't implemented their
 * own Strategy yet still fields a legal (if inert) agent.
 */
export class HoldStrategy implements Strategy {
  decide(view: mcp.StateView): mcp.TankOrder[] {
    return holdOrders(view.ownTanks);
  }
}

/**
 * Returns a legal "no-op" order for each tank in ownTanks: same heading,
 * same speed (always a legal change — the diff is zero), turret held.
 * Reference agents can use this as a starting point for tanks they choose
 * not to act on this impulse.
 */
export function holdOrders(ownTanks: mcp.TankView[]): mcp.TankOrder[] {
  return ownTanks.map((tank) => ({
    tankId: tank.id,
    speed: tank.speed,
    heading: tank.heading,
    turretHold: true,
    turretHeading: 0,
    fire: false,
    targetX: 0,
    targetY: 0,
  }));
}
