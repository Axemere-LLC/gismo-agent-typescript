/**
 * Package-level helpers for building orders that respect the referee's
 * per-impulse turn-rate and speed-change limits (game-and-protocol.md#match-protocol-mcp-tools).
 * They operate purely on the wire's integer encodings — heading is the
 * 8-point compass (0=North, clockwise, ..., 7=Northwest) and speed is the
 * 4-step scale (0=BackHalf, 1=Halted, 2=AheadHalf, 3=AheadFull) — so any
 * Strategy can use them without depending on gismo-platform's internal game
 * package. An order that turns or accelerates faster than these functions
 * allow is not corrected by the referee: it is rejected outright and the
 * tank holds instead, so getting this arithmetic right is what keeps a
 * Strategy's orders legal. Ported from gismo-agent-go's agent/legality.go.
 */

const NUM_HEADINGS = 8;
const HALTED = 1;

/** Minimum number of 45-degree compass steps between two headings (each in [0,7]), in [0,4]. */
export function turnDistance(a: number, b: number): number {
  const raw = (((a - b) % NUM_HEADINGS) + NUM_HEADINGS) % NUM_HEADINGS;
  return raw > NUM_HEADINGS / 2 ? NUM_HEADINGS - raw : raw;
}

/**
 * How many compass steps a tank may turn its hull in one impulse, given the
 * speed it is ordered to hold for that impulse: 2 if Halted (1), 1 otherwise.
 */
export function turnAllowance(orderedSpeed: number): number {
  return orderedSpeed === HALTED ? 2 : 1;
}

/**
 * The heading reached by turning current at most allowance compass steps
 * toward target, choosing whichever rotation direction is shorter (a tie —
 * target directly opposite current — turns clockwise). Returns current
 * unchanged if already at target or allowance is 0.
 */
export function stepHeadingToward(current: number, target: number, allowance: number): number {
  if (allowance <= 0) {
    return current;
  }
  let diff = (((target - current) % NUM_HEADINGS) + NUM_HEADINGS) % NUM_HEADINGS;
  if (diff > NUM_HEADINGS / 2) {
    diff -= NUM_HEADINGS; // now in (-4, 4]; negative means counter-clockwise is shorter
  }
  const step = Math.max(-allowance, Math.min(allowance, diff));
  return (((current + step) % NUM_HEADINGS) + NUM_HEADINGS) % NUM_HEADINGS;
}

/**
 * The speed reached by changing current by at most one step toward target
 * (each in [0,3]); the referee only permits a diff of -1, 0, or 1 per impulse.
 */
export function stepSpeedToward(current: number, target: number): number {
  if (target > current) return current + 1;
  if (target < current) return current - 1;
  return current;
}

/**
 * The 8-point compass heading that best points from (0,0) toward (dx,dy),
 * rounding to the nearest 45-degree sector (Y increases southward, matching
 * the grid's row-major convention). If dx and dy are both zero, returns
 * current unchanged since there is no direction to point toward.
 */
export function headingToward(dx: number, dy: number, current: number): number {
  if (dx === 0 && dy === 0) {
    return current;
  }
  let bearing = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (bearing < 0) {
    bearing += 360;
  }
  return Math.round(bearing / 45) % NUM_HEADINGS;
}
