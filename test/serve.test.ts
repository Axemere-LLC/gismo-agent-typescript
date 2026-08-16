import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultAddr } from "../src/agent/serve.js";

test("defaultAddr returns fallback when PORT is unset", () => {
  delete process.env.PORT;
  assert.equal(defaultAddr(":8080"), ":8080");
});

test("defaultAddr returns :$PORT when PORT is set", () => {
  process.env.PORT = "3000";
  try {
    assert.equal(defaultAddr(":8080"), ":3000");
  } finally {
    delete process.env.PORT;
  }
});

test("defaultAddr returns fallback when PORT is set but empty", () => {
  process.env.PORT = "";
  try {
    assert.equal(defaultAddr(":8080"), ":8080");
  } finally {
    delete process.env.PORT;
  }
});
