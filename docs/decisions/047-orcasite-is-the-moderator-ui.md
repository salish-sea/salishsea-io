# 047 — OrcaSound's tagging gets built in orcasite, which is the moderator UI that stays

**Status:** accepted · **Decided:** 2026-09-20 · **Answers:** `salish-8vr.22` · **Applies:** [028](028-salishsea-io-speaks-to-orcasound.md), [035](035-catalogue-migrates-before-tagging.md)

## Decision

**orcasite owns the moderator UI. Register-aware tagging is built there, and the good parts of the orcahello moderator portal are folded into it rather than the other way round.**

This is OrcaSound's call, not ours, and it was made by Scott Veirs. It is recorded here because it decides where our upstream work goes. It reached this record by the repository owner relaying it on 2026-09-20; as of that date it is not yet written on [orcasite#1017](https://github.com/orcasound/orcasite/issues/1017), where the question was asked, and it should be (`salish-8vr.23`).

Relayed the same day: **[orcasite#1013](https://github.com/orcasound/orcasite/issues/1013) — a `kind` and a stable identifier (`iri`) on tags — is accepted by the OrcaSound team in conversation.** The issue itself carries no comments, so the acceptance is likewise not yet on the record upstream. It is the first thing to build: every other piece of the tagging work ([#1014](https://github.com/orcasound/orcasite/issues/1014) certainty, [#1015](https://github.com/orcasound/orcasite/issues/1015) the picker, [#1016](https://github.com/orcasound/orcasite/issues/1016) classifying the existing 94 tags) stores or reads those two columns.

## Why it was open

On #1017 Dave Thaler pointed out that the premise behind "orcasite stays, the orcahello Blazor portal goes" had reversed: the volunteers now available know C# and not Elixir, and the orcahello portal had just had a run of improvements. He asked whether to pivot the end state to orcahello. Our reply at the time was that the register design — identifiers, multi-valued classifications, certainty — does not care which UI hosts it, and that the question deserved a conversation rather than a thread.

## What it settles for us

- **`salish-8vr.11` keeps its reduced scope.** The Blazor half of "send the model's class label" was dropped as dead work on the premise that orcasite becomes the single moderation UI. That premise now holds again.
- **`salish-8vr.19` is unblocked**: detection review is absorbed by orcasite, so whether `item_tags` must attach to detections as well as bouts is an orcasite schema question and can be answered.
- **Dave Thaler's requirements do not go away with the portal.** A per-detection "a human has moderated this" state, and the per-3-second segment predictions that exist only in OrcaHello's database, are things orcasite must grow to absorb that UI's job. "Fold in the good bits" includes these; they are tracked under `salish-8vr.23`.

## What it does not settle

Whether moderator tags stay bout-level or eventually reach 3-second granularity. Dave Thaler rejects bout-only as an end state; Dave Bain says finer tagging is too much moderator work today. Finer tags are additive to the bout-level design, so nothing built now forecloses them.

## Reference

Issue `salish-8vr.22`. The question: [orcasite#1017](https://github.com/orcasound/orcasite/issues/1017). The hub for the upstream ask: [orcasite#1001](https://github.com/orcasound/orcasite/issues/1001).
