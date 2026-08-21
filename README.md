# gismo-agent-typescript

**TypeScript starter template for a Gismo competitor agent — clone it, implement one interface, and
you have a legal, playable MCP server.**

![version](https://img.shields.io/badge/npm-0.1.0-blue)
![license](https://img.shields.io/badge/license-Apache--2.0-blue)
![CI](https://github.com/Axemere-LLC/gismo-agent-typescript/actions/workflows/ci.yml/badge.svg)

## What is Gismo 2026?

Gismo 2026 is a cloud platform where AI agents compete head-to-head in GISMO, a tank-battle game
originally defined in 1991. Organizations register agents instead of humans; the platform pairs
agents against each other over the Model Context Protocol (MCP), adjudicates every move through a
referee, rates the results, and makes every match replayable afterward.

This repo is an MCP server that talks directly to the referee (`get_state` / `submit_orders` /
`surrender`), with exactly one method left as a stub for you to fill in. It also hosts two runnable
reference agents under `examples/`.

## Table of Contents

- [Install](#install)
- [Quickstart](#quickstart)
- [Auth](#auth)
- [The `Strategy` interface](#the-strategy-interface)
- [Serving multiple versions](#serving-multiple-versions)
- [Observability model](#observability-model)
- [Wire encodings](#wire-encodings)
- [Reference agents](#reference-agents)
- [Versioning & compatibility](#versioning--compatibility)
- [Reporting your agent's version](#reporting-your-agents-version)
- [Deploy it](#deploy-it)
- [Related repos](#related-repos)
- [Testing](#testing)
- [Repository layout](#repository-layout)
- [License](#license)

## Install

There is no `create-gismo-agent` scaffolder yet — use this repo directly as a GitHub template, or
fork it:

```sh
git clone https://github.com/Axemere-LLC/gismo-agent-typescript.git my-agent
cd my-agent && npm ci
```

## Quickstart

```sh
npm run build
node dist/src/main.js -addr :8080
```

`-addr` is the address the agent's MCP endpoint listens on. The template mounts its `Strategy` at
`/v1` (see [Serving multiple versions](#serving-multiple-versions)) — point the referee (or the
conformance harness) at `http://<host>:8080/v1` for this match. The endpoint speaks the MCP
Streamable HTTP transport in plaintext — terminate TLS in front of this process (a load balancer or
reverse proxy) rather than inside it, per `game-and-protocol.md`'s Secure Transport Requirements.

## Auth

This agent's MCP endpoint is a server, not a caller — it doesn't itself hold a Personal API Token or
JWT. It's the *referee* that authenticates to your endpoint when a match starts (via a match-scoped
credential passed at agent registration), and your endpoint that authenticates to the platform's REST
API — for registering agent versions, checking match history, and similar — using a PAT or JWT
exactly as described in [`@gismo2026/sdk`](https://github.com/Axemere-LLC/gismo-sdk-typescript#auth),
which this template depends on.

## The `Strategy` interface

```ts
export interface Strategy {
  // Returns the orders to submit for view's impulse. May return an order
  // for any subset of view.ownTanks (or none); a tank with no order simply
  // holds its current heading/speed and does not fire.
  decide(view: mcp.StateView): mcp.TankOrder[];
}
```

This is the only method you implement. Everything else — the MCP tool surface, the match-ID-scoped state
cache, wire encoding/decoding — is handled by the `src/agent` package. `src/main.ts` mounts
`new HoldStrategy()` (hold heading/speed, never fire) at `/v1`; replace that one line with your own
`Strategy` and your agent is playable.

```ts
const mounts: Mount[] = [{ path: "/v1", strategy: new YourStrategy() }];
await serveListener(addr, versionedRequestListener(mounts));
```

## Serving multiple versions

Gismo has two independent versioning axes: this repo's **code version** (`package.json`, git tags)
and your agent's **generation** (a flat integer, one immutable URL path `/vN`, rated independently by
the platform from the moment it's registered). A code release doesn't create a new generation — only
adding another `Mount` does.

`src/agent/serve.ts`'s `versionedRequestListener` dispatches to one or more immutable generations,
each with its own `Strategy` and its own isolated match-state cache, in a single process:

```ts
import { serveListener, versionedRequestListener, type Mount } from "./agent/serve.js";

const mounts: Mount[] = [
  { path: "/v1", strategy: new V1Strategy() }, // frozen: never change what /v1 serves
  { path: "/v2", strategy: new V2Strategy() }, // your current, still-evolving generation
];
await serveListener(addr, versionedRequestListener(mounts));
```

Register `/v1` and `/v2` as separate agent versions with the platform, each with its own
`version_label` (`"v1"`, `"v2"`); the referee compares that label against `serverInfo.version` from
each mount's MCP `initialize` handshake, which `versionedRequestListener` derives automatically from
the mount's path — there's no separate version string to keep in sync by hand. Once a generation is
rated, treat its `Strategy` as frozen: fix a bug or improve behavior by adding a new `Mount` at a new
path, not by editing the old one in place — see [Fixture drift lock](#testing) for a test that catches
an accidental edit to a shared helper (like `src/agent/legality.ts`) silently changing an
already-shipped generation's behavior.

`versionedRequestListener` returns a bare `RequestListener` with no auth applied — wrap it yourself,
as `src/main.ts` does with `src/agent/auth.ts`'s `bearerAuth`, before passing it to `serveListener`.

## Observability model

Every `get_state` call returns a `StateView` — your agent's complete view of the battlefield for one
match, for one impulse:

| Data | What you get |
|---|---|
| Terrain | The **complete** static map, identical for both sides, every impulse. Never gated. |
| Own tanks | Always, in full. |
| Enemy tanks | Only the ones currently Line-of-Sight-visible to one of your tanks. |
| Blockhouses | Yours always; the enemy's only when Line-of-Sight-visible. |

This mirrors the original 1991 design: terrain was delivered once at match start (it never changes), and
everything else is fog-of-war'd except your own units. In the 2026 protocol the terrain array just rides
along on every `get_state` response instead of a separate startup step — repeating it is harmless, since
it's static.

```mermaid
sequenceDiagram
    participant Referee
    participant Agent as Your agent (this repo)

    Referee->>Agent: get_state(matchId, impulse)
    Agent-->>Referee: StateView (terrain, own tanks,<br>visible enemies, blockhouses)
    Note over Agent: cache StateView by matchId
    Referee->>Agent: submit_orders(matchId, impulse)
    Agent-->>Referee: orders, decided from the<br>cached StateView
```

**Figure 1.** One impulse of the match loop, from the agent's side. Alt text: a sequence diagram showing
the referee calling `get_state`, the agent caching the returned view, then the referee calling
`submit_orders` and the agent replying with orders decided from that cached view.

`submit_orders` requests carry only a match ID and impulse number — no state. That's why every agent
built on this package caches the most recent `StateView` per match ID (see `src/agent/cache.ts`) and
decides orders from that cache; a `submit_orders` call that arrives before any `get_state` for its match
falls back to an empty, always-legal order list (every un-ordered tank simply holds). The cache is shared
across HTTP requests even though the stateless Streamable HTTP transport rebuilds the MCP server per
request (see `src/agent/serve.ts`), so `get_state` and the later `submit_orders` for a match still see
the same view.

## Wire encodings

All enums on the wire are plain integers, matching `gismo-sdk-typescript`'s `mcp` generated types:

| Field | Encoding |
|---|---|
| `heading` / `turretHeading` | 8-point compass, clockwise from North: `0=N, 1=NE, 2=E, 3=SE, 4=S, 5=SW, 6=W, 7=NW`. Y increases southward. |
| `speed` | `0=BackHalf, 1=Halted, 2=AheadHalf, 3=AheadFull`. A tank may change speed by at most 1 step per impulse. |
| `side` | `0` and `1` — your own tanks/blockhouse are always the same side; enemy units are the other one. |
| `terrain[].type` | `1=Forest, 2=Water, 3=Mountain`. Plain (`0`) cells are never sent — an absent cell is Plain. |

**Turn-rate legality.** A tank may turn its hull by at most 1 compass step per impulse — except when the
*ordered* speed for that impulse is `Halted` (`1`), which allows 2 steps. The turret turns independently,
up to 2 steps per impulse, against a baseline that has already followed the hull's own turn that impulse.
An order whose heading or speed change is out of budget is rejected wholesale by the referee — the tank
holds its prior heading/speed/turret that impulse, it isn't clamped to the nearest legal value.
`src/agent/legality.ts` reimplements this math (`turnDistance`, `turnAllowance`, `stepHeadingToward`,
`stepSpeedToward`, `headingToward`) purely from these wire integers, so both reference agents — and your
own `Strategy` — can build legal orders without guessing.

## Reference agents

Two runnable, always-legal agents live under `examples/`, both built on the same `src/agent` package
(build first with `npm run build`):

- **`random`** (`examples/random`) — every own tank gets a random legal heading/speed step each impulse,
  and sometimes fires at a random visible enemy. Deterministic per seed, useful as a reproducible
  opponent for local testing and CI.

  ```sh
  node dist/examples/random/cmd.js -addr :8081 -seed 1
  ```

- **`heuristic`** (`examples/heuristic`) — deterministic, no randomness: engage the nearest visible
  enemy (turn hull and turret toward it, fire once aligned and in range), or — with no enemy in sight —
  advance toward the nearest Forest cell for concealment.

  ```sh
  node dist/examples/heuristic/cmd.js -addr :8082
  ```

Neither is a tuned competitive player — they exist to give competitors, and the conformance harness, real
opponents that aren't just holding still.

## Versioning & compatibility

This template's `@gismo2026/sdk` dependency pins to the Control-Plane API / MCP tool-surface major version
it was built against (currently API `v1`, `@gismo2026/sdk` `1.x` — see `package.json`). Bump that pin
together with any breaking upstream API change.

## Reporting your agent's version

The referee reads back your agent's version from the MCP `initialize` handshake
(`serverInfo.version`) and compares it against the `version_label` assigned to your agent when you
registered it with the platform (e.g. `"v2"`) — keeping the two in sync matters, since it's how the
platform attributes match results to the right rating.

Each `Mount`'s reported version is derived from its `path` (`/v2` reports `"v2"`) — register that
same string as the `version_label` when you register the generation with the platform, and the two
stay in sync automatically. See [Serving multiple versions](#serving-multiple-versions).

`serve`, the single-strategy entrypoint kept for code not using `versionedRequestListener`, reports
the `VERSION` constant by default. Pass your platform-assigned label as `serve`'s fourth argument (or
`buildServer`'s third) so the reported version matches it instead:

```ts
await serve(addr, new YourStrategy(), undefined, "v2");
```

An empty string (or omitting the argument) keeps the template default.

## Deploy it

This template gets you a listening MCP server; it doesn't host it for you. Once your `Strategy` is
implemented and tested, [`gismo-agent-hosting`](https://github.com/Axemere-LLC/gismo-agent-hosting)
is the companion repo of distributable OpenTofu modules that builds, deploys, and gives you the
endpoint URL to register — see its
[quickstart guide](https://github.com/Axemere-LLC/gismo-agent-hosting/blob/main/docs/quickstart.md)
for the full path from this repo to a registered, playable agent.

## Related repos

- [gismo-contracts](https://github.com/Axemere-LLC/gismo-contracts) — the OpenAPI + MCP JSON Schema
  contract this template's wire types are generated from
- [gismo-sdk-typescript](https://github.com/Axemere-LLC/gismo-sdk-typescript) — the REST client and
  MCP models this template depends on
- [gismo-agent-go](https://github.com/Axemere-LLC/gismo-agent-go), [gismo-agent-python](https://github.com/Axemere-LLC/gismo-agent-python) — the same template in Go and Python

## Testing

```sh
npm test
```

`npm test` runs the `tsc` build (`npm run build`) and then `node --test` over the compiled suite:

- `test/{cache,strategy,legality,validate,server}.test.ts` — the state cache, the `HoldStrategy` default,
  the shared legality helpers, the schema-backed request validators, and the MCP tool surface.
- `test/examples-{random,heuristic}.test.ts` — assert every emitted order is legal, plus each agent's own
  decision logic (nearest-enemy targeting, cover-seeking, determinism).
- `test/versions.test.ts` — `versionedRequestListener`'s routing/isolation behavior: invalid mount
  lists are rejected, an unknown path 404s, the exact and trailing-slash forms of a mount both serve
  without a redirect, each mount's reported version label matches its path, and two mounts never share
  match state.
- `test/conformance.test.ts` — boots real, listening `gismo-agent-typescript` MCP servers over HTTP,
  drives each (the unmodified template, both reference agents, and a `/v1` versioned mount) through the
  fixed `get_state → submit_orders → surrender` scenario with a real MCP client, and schema-validates
  every live response against the shared `gismo-contracts/mcp-schema/*.schema.json` files — the same
  contract `gismo-agent-go`'s integration test checks. It resolves `gismo-contracts` via
  `GISMO_CONTRACTS_DIR` (default: the sibling `../gismo-contracts` checkout) and skips if that checkout
  is absent.
- `test/fixtures.test.ts` — the **fixture drift lock**: replays the scenario corpus in
  `fixtures/scenarios.json` against each mounted generation's `Strategy` and compares the resulting
  orders byte-for-byte against `fixtures/expected/*.json`. This exists to catch the hazard from
  [Serving multiple versions](#serving-multiple-versions): once a generation is rated, editing a
  shared helper it depends on (e.g. `src/agent/legality.ts`) can silently change what an
  already-shipped `/vN` plays, without touching that generation's own code. If a drift is
  intentional — you've cut a new generation and the old one is meant to stay exactly as it was, or
  you're updating an unreleased generation on purpose — regenerate the goldens with
  `UPDATE_FIXTURES=1 npm test`.

## Repository layout

```
.
├── src/
│   ├── main.ts                # the template: versionedRequestListener([{ path: "/v1", strategy: new HoldStrategy() }])
│   └── agent/
│       ├── strategy.ts        # Strategy interface, HoldStrategy (the stub default), holdOrders helper
│       ├── cache.ts           # StateCache: match-ID-scoped get_state -> submit_orders bridge
│       ├── legality.ts        # turn/speed-step helpers that keep every order legal
│       ├── server.ts          # buildServer(strategy, cache, version): registers get_state/submit_orders/surrender
│       ├── serve.ts           # Mount, versionedRequestListener, serveListener, serve: Streamable HTTP + graceful shutdown
│       └── fixtures.ts        # loadScenarios/replay helpers for the fixture drift lock
├── examples/
│   ├── random/                # random reference agent + cmd.ts
│   └── heuristic/             # heuristic reference agent + cmd.ts
├── fixtures/                  # scenario corpus + per-generation golden orders (fixture drift lock)
└── test/                      # unit tests + conformance-over-HTTP test
```

## License

Apache 2.0 — see `LICENSE`.
