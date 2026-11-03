# TASK-005 — Engine host (Web Worker)

Owner: unassigned
Gate: 1
Depends on: TASK-003

## Goal

The engine runs off the main thread with the typed request, reply and event protocol from
architecture section 10, a play loop that tracks wall time with a speed multiplier and reports
what it actually achieved, and pulled, transferable snapshots.

## In scope

- `src/host/protocol.ts` (message types, exactly section 10), `src/host/worker.ts` (worker
  entry: owns engine, route provider, link costs, play loop), `src/host/client.ts`
  (`createEngineClient(worker: Worker): EngineClient` with promise-returning methods and an
  `onEvent` subscription), `src/host/loop.ts` (play loop logic, pure enough to unit test with
  an injected clock).
- `tests/host/loop.test.ts`, `tests/host/protocol.test.ts`.

## Out of scope

- UI. The client is consumed by TASK-009.
- Any sim change beyond calling its public API.

## Interfaces

`HostRequest`, `HostReply`, `HostEvent` from section 10.

```ts
interface EngineClient {
  load(input: { compiled: CompiledCity; trips: TripRequest[]; scenario: Scenario }): Promise<void>;
  play(): Promise<void>; pause(): Promise<void>; setSpeed(multiplier: number): Promise<void>;
  step(steps: number): Promise<void>; restart(): Promise<void>;
  snapshot(): Promise<VehicleSnapshot>;   // at most one in flight; a second call awaits the first
  metrics(): Promise<Metrics>; inspect(id: number): Promise<VehicleDetail | null>; hash(): Promise<number>;
  onEvent(listener: (e: HostEvent) => void): () => void;
  terminate(): void;
}
```

## Acceptance tests

- `loop.test.ts`: with an injected clock, multiplier 5 advances 50 steps per wall second;
  when the step budget per tick is exceeded, the achieved multiplier reported in `tick` drops
  and the loop never runs more than the cap per tick; pause stops stepping; `finished` fires
  at `scenario.endS`.
- `protocol.test.ts`: every request kind round-trips through the reply matcher; an engine
  error surfaces as `{ ok: false, error }` with the message, not as a thrown worker error.
- Manual check recorded in the PR: in the browser, `dev/host.html` (a dev page, not part of
  the build) loads `grid5x5`, plays at 10x, and the snapshot buffers are transferred (byte
  length 0 on the worker side after post).

## Commands

`npm run check`

## Deliverable

PR with host and tests. Note in the description the per-tick step cap chosen and the
`postMessage(data, { transfer })` typing approach from section 10.
