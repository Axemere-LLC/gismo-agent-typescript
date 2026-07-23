import assert from "node:assert/strict";
import { test } from "node:test";

import { headingToward, stepHeadingToward, stepSpeedToward, turnAllowance, turnDistance } from "../src/agent/legality.js";

const turnDistanceCases: Array<[string, number, number, number]> = [
  ["identical headings", 0, 0, 0],
  ["adjacent clockwise", 0, 1, 1],
  ["adjacent counter-clockwise", 1, 0, 1],
  ["opposite headings", 0, 4, 4],
  ["wraps north going clockwise", 7, 1, 2],
  ["wraps north going counter-clockwise", 1, 7, 2],
];

for (const [name, a, b, want] of turnDistanceCases) {
  test(`turnDistance: ${name}`, () => {
    assert.equal(turnDistance(a, b), want);
  });
}

const turnAllowanceCases: Array<[string, number, number]> = [
  ["back half", 0, 1],
  ["halted doubles the allowance", 1, 2],
  ["ahead half", 2, 1],
  ["ahead full", 3, 1],
];

for (const [name, orderedSpeed, want] of turnAllowanceCases) {
  test(`turnAllowance: ${name}`, () => {
    assert.equal(turnAllowance(orderedSpeed), want);
  });
}

const stepHeadingTowardCases: Array<[string, number, number, number, number]> = [
  ["already at target", 3, 3, 1, 3],
  ["zero allowance holds", 0, 4, 0, 0],
  ["single step clockwise", 0, 1, 1, 1],
  ["clamped short of target, clockwise", 0, 3, 2, 2],
  ["clamped short of target, counter-clockwise", 0, 5, 1, 7],
  ["opposite target ties clockwise", 0, 4, 1, 1],
  ["wraps north going clockwise", 7, 1, 2, 1],
  ["halted allowance covers a 2-step turn", 0, 2, 2, 2],
];

for (const [name, current, target, allowance, want] of stepHeadingTowardCases) {
  test(`stepHeadingToward: ${name}`, () => {
    const got = stepHeadingToward(current, target, allowance);
    assert.equal(got, want);
    assert.ok(turnDistance(current, got) <= allowance, "step must not exceed the allowance");
  });
}

const stepSpeedTowardCases: Array<[string, number, number, number]> = [
  ["already at target", 2, 2, 2],
  ["accelerate one step", 1, 3, 2],
  ["decelerate one step", 3, 0, 2],
  ["large jump clamped to one step up", 0, 3, 1],
  ["large jump clamped to one step down", 3, 0, 2],
];

for (const [name, current, target, want] of stepSpeedTowardCases) {
  test(`stepSpeedToward: ${name}`, () => {
    assert.equal(stepSpeedToward(current, target), want);
  });
}

const headingTowardCases: Array<[string, number, number, number, number]> = [
  ["no delta holds current heading", 0, 0, 5, 5],
  ["due north", 0, -1, 0, 0],
  ["north-east", 1, -1, 0, 1],
  ["due east", 1, 0, 0, 2],
  ["south-east", 1, 1, 0, 3],
  ["due south", 0, 1, 0, 4],
  ["south-west", -1, 1, 0, 5],
  ["due west", -1, 0, 0, 6],
  ["north-west", -1, -1, 0, 7],
  ["scaled vector still resolves to due north", 5, -5, 0, 1],
  ["mostly-north nudge rounds to north", 1, -8, 0, 0],
];

for (const [name, dx, dy, current, want] of headingTowardCases) {
  test(`headingToward: ${name}`, () => {
    assert.equal(headingToward(dx, dy, current), want);
  });
}

test("stepHeadingToward never exceeds the given allowance, for every heading/target/allowance combination", () => {
  for (let current = 0; current < 8; current++) {
    for (let target = 0; target < 8; target++) {
      for (let allowance = 0; allowance < 3; allowance++) {
        const stepped = stepHeadingToward(current, target, allowance);
        assert.ok(
          turnDistance(current, stepped) <= allowance,
          `current=${current} target=${target} allowance=${allowance} stepped=${stepped}`,
        );
      }
    }
  }
});
