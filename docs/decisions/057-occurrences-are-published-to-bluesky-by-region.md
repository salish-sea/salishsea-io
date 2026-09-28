# 057 — Occurrences are published to Bluesky, one account per region; Bluesky delivers them

**Status:** proposed · **Decided:** 2026-09-28 (framing) · **Relates to:** [001](001-product-framing.md), [013](013-orcasound-acoustic-occurrences.md), [022](022-regions-filter-data.md), [055](055-occurrences-are-stored-not-assembled.md), [rights policy §4](../rights-policy.md)

## Context

The goal is a gradual move of SalishSea.io, and eventually Orcasound, onto
atproto. The first step people asked for is "tell me when orcas are around
where I am."

That sounds like push notifications, which [001](001-product-framing.md) and
PRODUCT.md rule out. It isn't. On atproto the natural shape is a
**publication**: SalishSea.io writes posts to its own repository, and people
who want to hear about them follow the account and turn on Bluesky's
per-account post notifications. Bluesky decides whether and how to push. We
run no delivery, hold no device tokens and keep no subscriber list, so 001's
exclusion stands untouched.

No AppView is needed for this. An AppView indexes *other people's* records;
this step only writes our own.

Almost all of the volume will come from **Maplify** (Orca Network, Whale
Alert, Cascadia, via Acartia). Orcasound bouts belong in the same stream,
since a bout is an occurrence like any other ([013](013-orcasound-acoustic-occurrences.md)),
but at a few per month and curated after the fact they will be rare. They
will rarely be timely.

## Decision

1. **One Bluesky account per region.** The regions are the existing
   `REGIONS` in `src/constants.ts`. "Your area" is simply the account you
   follow. Regions nest (San Juans ⊂ Salish Sea ⊂ SRKW range), so an
   occurrence is posted by every region account whose extent contains it.
   `everywhere` gets no account.
2. **The unit posted is an occurrence** from `derived.occurrences`. That
   table is already stored and kept current per writer
   ([055](055-occurrences-are-stored-not-assembled.md)), so a trigger or a
   diff against it can feed an outbox. The outbox holds one row per
   occurrence × region with the resulting post's `at://` URI. Publishing is
   idempotent on that row.
3. **The first report of a species in a region on a Pacific day is a
   top-level post. Later ones reply in its thread.** Followers are pinged
   once ("orcas in the San Juans today"), and the thread carries the play-by-play.
   A busy J-pod day on Maplify can produce dozens of reports, and a post for
   each would make the bell unusable. Segments are imputed client-side, so
   they are not the threading key. The rule is deliberately
   (region, species, day).
4. **Post text is templated, never the source's comment.** It gives species,
   any identifiers ([candidate identifiers](../../CONTEXT.md), marked as
   reported), place, time and source, plus a link to `salishsea.io/?o=…`.
   The link preview already works (v1.0, [026](026-branded-fallback-preview-image.md)).
   Maplify comments can carry reporter contact details and overrun the
   300-grapheme limit, and `maplify.sightings.comments` is ours to parse, not
   to republish.
5. **Attribution follows the rights policy.** Maplify records are CC-BY 4.0
   through Acartia, so every post names the originating sub-source (Orca
   Network, Cascadia, …). Photos are attached only where the Multimedia export
   would include them, which excludes Maplify photos today.
6. **Withdrawal follows the record.** When an occurrence leaves
   `derived.occurrences` (deleted upstream, rejected, moved out of scope), its
   post is deleted.
7. **It runs like ingest**: `pg_cron` calls a function on the same
   five-minute cadence ([011](011-ingest-imperative-shell.md)), with an
   imperative shell (session, `createRecord`/`deleteRecord`) over a pure
   core (occurrence → post text, thread parent). App passwords for the region
   accounts are kept in Vault.

## Open before accepting

- **Courtesy and norms.** Rights policy §4 already calls for a courtesy
  notice to Orca Network, Whale Alert/Conserve.IO and Cascadia before
  republishing. This is a second, livelier republication, into an open,
  indexed, permanent network that boaters read. Ask them, and Orcasound,
  whether they want a delay or coarser locations for Southern Residents. The
  answer may change item 4.
- **Account handles.** For example `sanjuans.salishsea.io`, verified by DNS
  on the domain we already own.
- **Taxa.** All in-scope taxa, or cetaceans only? A harbor-seal post every
  few minutes would bury the whales. A likely answer is cetaceans only, with
  pinnipeds left to the map.

## Rejected alternatives

- **Push delivery of our own** (web push, email, DMs from a bot). This is
  the real reversal of 001. It needs a subscriber store, and holding user
  locations is a privacy liability, all to duplicate what Bluesky's bell
  already does.
- **Custom feeds per region.** A feed generator is a nice way to browse, but
  feeds don't notify. It may be worth adding later; it is not the MVP.
- **One account, filtered by hashtag or feed.** Notifications attach to an
  account, so "your area" has to be an account.
- **A post per report, unthreaded.** See item 3.
- **Custom lexicon records first** (`io.salishsea.occurrence`). This is the
  right *second* step, because it puts structured data on the firehose. But
  it reaches no one until someone builds on it, while posts reach people now.

## Later steps (not decided here)

- Publish structured `io.salishsea.occurrence` records beside the posts. Have
  orcasite publish its own bouts from its own repository, since it is the
  asserter.
- A labeler for our verification `status` on other people's records
  ([054](054-certainty-is-the-asserters-status-is-ours.md)).
- Sighters writing sightings to their own repositories, indexed here. That is
  the AppView, and it would bring atproto sign-in beside Google.
