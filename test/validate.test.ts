import assert from "node:assert/strict";
import { test } from "node:test";

import { ValidationError, validateGetState, validateSubmitOrdersRequest, validateSurrenderRequest } from "../src/agent/validate.js";

const validView = {
  matchId: "m1",
  impulse: 1,
  terrain: [],
  ownTanks: [],
  visibleTanks: [],
  blockhouses: [],
};

test("validateGetState accepts a well-formed StateView", () => {
  assert.doesNotThrow(() => validateGetState(validView));
});

test("validateGetState rejects a missing required field", () => {
  const { matchId: _matchId, ...missingMatchId } = validView;
  assert.throws(() => validateGetState(missingMatchId), ValidationError);
});

test("validateGetState rejects an unknown top-level property", () => {
  assert.throws(() => validateGetState({ ...validView, bogus: true }), ValidationError);
});

test("validateGetState rejects a wrong-typed field", () => {
  assert.throws(() => validateGetState({ ...validView, impulse: "not-a-number" }), ValidationError);
});

test("validateGetState rejects a nested tank with an unknown property", () => {
  const view = {
    ...validView,
    ownTanks: [{ id: 1, side: 1, x: 0, y: 0, heading: 0, speed: 0, turretHeading: 0, ammo: 4, hitsTaken: 0, bogus: true }],
  };
  assert.throws(() => validateGetState(view), ValidationError);
});

test("validateSubmitOrdersRequest accepts a well-formed request", () => {
  assert.doesNotThrow(() => validateSubmitOrdersRequest({ matchId: "m1", impulse: 1 }));
});

test("validateSubmitOrdersRequest rejects a wrong-typed field", () => {
  assert.throws(() => validateSubmitOrdersRequest({ matchId: "m1", impulse: "not-a-number" }), ValidationError);
});

test("validateSubmitOrdersRequest rejects a missing required field", () => {
  assert.throws(() => validateSubmitOrdersRequest({ matchId: "m1" }), ValidationError);
});

test("validateSurrenderRequest accepts a well-formed request", () => {
  assert.doesNotThrow(() => validateSurrenderRequest({ matchId: "m1" }));
});

test("validateSurrenderRequest rejects a missing matchId", () => {
  assert.throws(() => validateSurrenderRequest({}), ValidationError);
});

test("validateSurrenderRequest rejects an unknown property", () => {
  assert.throws(() => validateSurrenderRequest({ matchId: "m1", bogus: true }), ValidationError);
});
