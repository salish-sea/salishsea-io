# 066 — A deploy takes the build lock before the switch; the machine stops its writers on the stop signal

**Status:** accepted · **Decided:** 2026-10-05 · **Prerequisite of:** bd `salish-t3g.5` (deploying the Fly app from GitHub Actions) · **Context:** bd `salish-t3g.8` · **Departs from:** the mechanism, not the rule, of [BeeAtlas ADR 0042](https://github.com/rainhead/beeatlas/blob/main/docs/adr/0042-beeatlas-moves-to-fly-as-one-stateful-machine.md)

## Context

`fly deploy` replaces the `salishsea-io` machine: Fly sends the main process its `kill_signal` (default `SIGINT`), waits `kill_timeout` (default 5 s), then `SIGKILL`s what is left. Until now `fly.toml` set neither and `fly/start.sh` trapped nothing. Every process `start.sh` starts with `&` ignores `SIGINT` (bash does this for background jobs when job control is off), so on every deploy Caddy, the read-path build, the write API and Litestream all ended at the `SIGKILL`:

- **A build in flight was cut off**, possibly between the two renames that swap the day files into place. Builds run every five minutes and after every write, so a deploy usually lands on one.
- **A write in flight was dropped.** Since the cutover to [065](065-the-store-and-write-api.md) on 2026-10-05, the machine holds what users write.
- **Litestream skipped its final sync.** Nothing was lost — SQLite's WAL survives on the volume and Litestream catches up at the next start — but the replica stayed up to a second behind for as long as the machine was down.

At a few hand deploys a day this was tolerable. `salish-t3g.5` deploys on every merge, so it would be routine.

ADR 0042's rule for BeeAtlas is that **a deploy never kills a running build**, and its mechanism is that CI takes the build lock before deploying. Its consequences don't cover a write API under Litestream, which BeeAtlas doesn't put behind the lock.

One fact decides where the waiting goes: **Fly's proxy stops sending new requests to a machine once it is being stopped or updated.** With one machine, every second the old machine spends shutting down is a second the site doesn't answer.

## Decision

**The deploy waits for the build, before the switch.** `fly/deploy.sh` builds and pushes the image first (`fly deploy --build-only --push`, tagged with the commit and the Stelis pin), while the machine goes on building and serving. It then takes `/data/build.lock` over `fly ssh console`, which waits out a running build, and only then deploys the pushed image. While the lock is held, a scheduled build skips its run and the API's build trigger retries, so nothing starts. The lock dies with the old machine.

- The session holding the lock outlives the local client: killing `fly ssh console` leaves the remote side running (tested 2026-10-05). So the hold lets go by itself after ten minutes, and a deploy that fails before the machine is replaced releases it explicitly.
- A build still running after five minutes is likely stuck, so the deploy fails rather than kill it. The image is already pushed, so a rerun is a deploy of that tag.

**The machine stops its writers, and only those, on `SIGTERM`.** `fly.toml` sets `kill_signal = "SIGTERM"` and `kill_timeout = 60`. `start.sh` traps the signal and shuts down in this order:

1. It stops the schedule.
2. It signals the write API's supervisor and waits for it. Litestream passes the signal to the API, which finishes the requests in flight (ten seconds at most) and exits. Litestream then makes its final sync, retrying for up to thirty seconds.
3. It stops Caddy and the redirect server, then exits 0.

It doesn't wait for a build. Under `fly/deploy.sh` there isn't one running. Under any other stop (a `fly machine restart`, a host migration) the build is killed as before, and the next build repairs it, as it already does after an out-of-memory kill.

## Rejected alternatives

- **Wait for the build inside the shutdown handler.** This was the first design. It needs no remote lock, and it covers every kind of stop, not only deploys. But Fly has stopped routing to the machine by the time the signal arrives, so the wait is downtime: up to the length of a rebuild (a few minutes) on every merge. It also caps waiting at `kill_timeout`'s five-minute maximum on shared CPUs, after which the build is killed anyway.
- **Only the lock, as in ADR 0042.** That keeps builds safe but still kills the write API and Litestream at the `SIGKILL`, which is the part that holds what users write.
- **Hold the lock for the whole deploy, image build included.** That's simpler, with no separate build step, but the remote build takes minutes and no read-path build would run during them. The map would go stale on every merge for no reason.

## Consequences

- A deploy is now two `fly deploy` calls, and an image's tag names its commit and its Stelis pin, so `fly deploy --image` with that tag redeploys any earlier one. [The deploys runbook](../runbook/deploys.md) says so.
- Under the lock, a deploy's switch costs the site about as long as the new machine takes to boot and pass its health check. The old machine's shutdown, waiting for the API and Litestream, adds seconds.
- `salish-t3g.5`'s workflow calls `fly/deploy.sh` rather than restating it, so hand deploys and CI take the same lock.
