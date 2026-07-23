import type { mcp } from "@gismo/sdk";

/**
 * Holds the most recent get_state view per match ID.
 *
 * submit_orders carries only matchId and impulse — no state
 * (game-and-protocol.md#match-protocol-mcp-tools) — so an agent must
 * remember the last view it was handed for a match to know what to respond
 * with. The referee delivers that view by calling get_state with the view
 * as arguments and expecting it echoed back unchanged; get_state is this
 * cache's only write path. Node's single-threaded event loop means this
 * needs no lock, unlike gismo-agent-go's mutex-guarded stateCache.
 */
export class StateCache {
  private readonly views = new Map<string, mcp.StateView>();

  store(matchId: string, view: mcp.StateView): void {
    this.views.set(matchId, view);
  }

  load(matchId: string): mcp.StateView | undefined {
    return this.views.get(matchId);
  }

  forget(matchId: string): void {
    this.views.delete(matchId);
  }
}
