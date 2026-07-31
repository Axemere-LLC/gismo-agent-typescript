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
- [Observability model](#observability-model)
- [Wire encodings](#wire-encodings)
- [Reference agents](#reference-agents)
- [Versioning & compatibility](#versioning--compatibility)
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

`-addr` is the address the agent's MCP endpoint listens on. Point the referee (or the conformance
harness) at `http://<host>:8080` for this match. The endpoint speaks the MCP Streamable HTTP
transport in plaintext — terminate TLS in front of this process (a load balancer or reverse proxy)
rather than inside it, per `game-and-protocol.md`'s Secure Transport Requirements.

## Auth

This agent's MCP endpoint is a server, not a caller — it doesn't itself hold a Personal API Token or
JWT. It's the *referee* that authenticates to your endpoint when a match starts (via a match-scoped
credential passed at agent registration), and your endpoint that authenticates to the platform's REST
API — for registering agent versions, checking match history, and similar — using a PAT or JWT
exactly as described in [`@gismo/sdk`](https://github.com/Axemere-LLC/gismo-sdk-typescript#auth),
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
cache, wire encoding/decoding — is handled by the `src/agent` package. `src/main.ts` wires
`new HoldStrategy()` (hold heading/speed, never fire) into `serve`; replace that one line with your own
`Strategy` and your agent is playable.

```ts
await serve(addr, new YourStrategy());
```

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

This template's `@gismo/sdk` dependency pins to the Control-Plane API / MCP tool-surface major version
it was built against (currently API `v1`, `@gismo/sdk` `1.x` — see `package.json`). Bump that pin
together with any breaking upstream API change.

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
- `test/conformance.test.ts` — boots real, listening `gismo-agent-typescript` MCP servers over HTTP,
  drives each (the unmodified template and both reference agents) through the fixed
  `get_state → submit_orders → surrender` scenario with a real MCP client, and schema-validates every
  live response against the shared `gismo-contracts/mcp-schema/*.schema.json` files — the same contract
  `gismo-agent-go`'s integration test checks. It resolves `gismo-contracts` via `GISMO_CONTRACTS_DIR`
  (default: the sibling `../gismo-contracts` checkout) and skips if that checkout is absent.

## Repository layout

```
.
├── src/
│   ├── main.ts                # the template: serve + new HoldStrategy()
│   └── agent/                 # MCP server, state cache, Strategy interface, legality + validators
├── examples/
│   ├── random/                # random reference agent + cmd.ts
│   └── heuristic/             # heuristic reference agent + cmd.ts
└── test/                      # unit tests + conformance-over-HTTP test
```

## License

Apache 2.0 — see `LICENSE`.
