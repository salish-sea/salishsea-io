# 014 — Trust & curation model: claims have status, people have reputation, curators assert both

**Status:** proposed (direction) · **Decided:** 2026-07-07

## Context

The identification foundation ([anx], PR #318) introduced `public.identifications` with a
`status` column (`candidate` / `validated` / `rejected`) and made the honest split explicit:
a regex-extracted code is a **candidate**, never a validated identification (see
[CONTEXT.md](../../CONTEXT.md), [rights-policy §2.4](../rights-policy.md), decision 008). That
raises the governing question it deliberately defers: *who* is trusted to promote a candidate to
validated, cast doubt on it, or reject it — and on what standing.

This record fixes the **direction** so later work (the verification workflow [ek3], explicit
tagging / curation UI [#52], CV/Flukebook) builds toward one model. It does **not** build it.

## Decision

The trust model rests on three primitives:

1. **Claims carry status.** An identification (and, by extension, other assertions we may add)
   carries a trust status. Shipped today on `identifications.status`; the exact vocabulary
   (whether a soft "disputed"/doubtful state joins candidate/validated/rejected, or trust becomes
   a spectrum) is not yet fixed.
2. **People carry reputation.** Contributors and other asserting parties carry a reputation that
   weights how much their claims are trusted. Not yet modeled.
3. **Privileged assertion.** Certain people — **curators** — are privileged to set claim status
   and person reputation: to assert trust *on behalf of the site and dataset*, over others and
   over others' claims. Not all asserters are equal. No role/write-path exists yet
   (`identifications` is SELECT-only; only the table owner writes).

This is the **interaction-design** layer over the data model already in flight.

## Terminology

- **Curator** — the operative meaning going forward is **curational trust judgment**: judging how
  much to trust evidence, and a person, on behalf of the dataset. This **supersedes the narrow
  "operator / ingest-control" framing** in CONTEXT.md's earlier Curator entry — that ingest
  control is one *facet* of the same role, held by the same people in practice, not a separate
  concept.
- **Moderator action** — flagging spam / abuse (content hygiene). Distinct in kind from curation
  (a trust judgment), though likely the same people. Not modeled.
- **Operator** — the mechanical "force an ingest action" capability the old Curator entry
  described; retained as a facet of curator, not a coined term.

## Not decided here (deferred)

- The final `status` vocabulary (add `disputed`? a numeric confidence spectrum?).
- Whether claims/identifications need an **annotation / remarks** field (curator reasoning).
- The **reputation** mechanism (per-party score? derived from validated-claim track record?).
- The privilege mechanism: a `curator` role, RLS **write** policies on `identifications`, and the
  moderation/annotation **UI** (ek3, #52).
- Whether curation targets identifications only, or also the **sighting/occurrence** itself
  (vouching-for / doubting / annotating a whole observation).

## Rationale

Preserves the candidate-vs-validated honesty invariant PR #318 established, and gives it a
governance answer: a candidate is promoted, doubted, or rejected by a *privileged, reputationed*
human acting for the dataset — not by the loudest asserter or by the system silently. Recording
the primitives now keeps ek3/#52/CV converging on one model instead of inventing three.

[anx]: bd salishsea-io-anx
[ek3]: bd salishsea-io-ek3
