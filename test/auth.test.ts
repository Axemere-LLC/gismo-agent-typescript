import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { test } from "node:test";

import { bearerAuth } from "../src/agent/auth.js";

async function withServer(
  key: string,
  fn: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const handler = bearerAuth(key, (_req, res) => {
    res.writeHead(200).end("ok");
  });
  const server: Server = createServer(handler);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("expected server to bind an AddressInfo");
  }
  try {
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("bearerAuth: correct key is authorized", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "Bearer secret" } });
    assert.equal(res.status, 200);
  });
});

test("bearerAuth: wrong key is rejected", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "Bearer wrong" } });
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: missing header is rejected", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: header missing the Bearer prefix is rejected", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "secret" } });
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: configured key that is only a prefix of the header value is rejected", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "Bearer secretextra" } });
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: empty bearer value is rejected", async () => {
  await withServer("secret", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "Bearer " } });
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: empty configured key rejects even an empty bearer value", async () => {
  await withServer("", async (baseUrl) => {
    const res = await fetch(baseUrl, { headers: { Authorization: "Bearer " } });
    assert.equal(res.status, 401);
  });
});

test("bearerAuth: empty configured key rejects a missing header too", async () => {
  await withServer("", async (baseUrl) => {
    const res = await fetch(baseUrl);
    assert.equal(res.status, 401);
  });
});
