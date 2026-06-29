---
title: Community uptake — win the shore regular via an Orca Network partnership
date: 2026-06-29
context: /gsd-explore session on improving uptake by the whale-sighting community
related:
  - .planning/PROJECT.md
  - .planning/research/questions.md
  - .planning/seeds/sighter-contribution-visible.md
---

# Community uptake: win the shore regular via an Orca Network partnership

Captures the strategy that emerged from the 2026-06-29 `/gsd-explore` session.
The first four milestones were all backend/data plumbing (links, partner-org
links, DwC-A export, provenance graph). This is the first deliberate look at
**community uptake** — getting the whale-sighting community to actually use the
site.

## The reasoning chain (target → persona → competitor → wedge)

1. **Target behavior = first-party submissions.** "Uptake working" means
   sighters *log on SalishSea.io first* (or here AND Facebook), not just visits
   or shares. Submissions are the metric.

2. **Primary persona = the shore regular.** The high-value, mission-driven
   sighter who lives on the water, watches often, and is already in the Orca
   Network Facebook orbit. Hard to pry from Facebook, but anchors the data and
   the community. (Deliberately *not* optimizing first for the enthusiast
   newcomer, naturalist/operator, or accidental tourist.)

3. **The real competitor isn't "Facebook."** It's one specific function that
   happens to live inside a Facebook group: **Orca Network's real-time
   sighting-coordination feed.** A post ("orcas northbound past Lime Kiln!")
   mobilizes the regulars, who reply with updates and track the pod up the
   strait; later Orca Network staff manually transcribe those posts into the
   historical record. That delivers both the sighter's reciprocity ("where are
   they, where headed") and the contribution-to-record motive — crudely, as
   unstructured text with no map, no trajectory, no search, total lock-in.

4. **The wedge = do that coordination function properly.** A map-first,
   structured, trajectory-aware real-time sighting tool is a categorically
   better fit for the job than a Facebook feed. The shore regular won't *abandon*
   the FB group (community + social reward), so integration must let them keep
   that audience while the canonical, structured record lives here.

5. **Lead with the relationship, not a scraping hack.** Chosen integration
   direction: **partner with Orca Network** — make the site the tool Orca
   Network *uses* to coordinate and record sightings, so the community follows
   the org they're already loyal to. The shore regular is loyal to Orca Network
   (Howard Garrett & Susan Berta), not to "Facebook."

## The offer reframe (the important correction)

Initial instinct was that the strongest offer to Orca Network was **#2 — credit
their data** (their sightings become a named, attributed dataset in GBIF/OBIS
via the v1.3 provenance graph). The research pass corrected this:

- **Acartia is our own org** (github.com/salish-sea/acartia). Orca Network
  *already* feeds sightings into Acartia → Ocean Wise's WRAS → Conserve.io.
  >75% of WA sightings into WRAS (April 2024) came from Orca Network via
  Acartia. So this is a **warm** relationship, not a cold start — and Orca
  Network is a proven, culturally pro-open-data cooperative member.
- Therefore **#2 (data credit) is mostly already solved** — open data isn't
  their pain, and our DwC-A deliberately *excludes* self-publishing sources.
- The research **independently named our exact niche as the unfilled one:** "a
  modern, map-first, community-facing sightings UX that **reduces curation
  labor** and surfaces real-time shore sightings — distinct from mariner-alert
  (WRAS/Whale Alert) and photo-ID (Happywhale/iNaturalist) tools."

**Conclusion:** the strongest offer is **#1 (delete their chore — kill the
manual Facebook-to-report transcription) + #3 (a better field/coordination
tool).** The data-credit (#2) and contribution-visibility (#4) become
*reinforcing* benefits layered on top, not the lead.

## The prize (why it's worth it)

- ~1,150 reporters/year, **¾ first-timers** → the *regulars* are the curating
  core worth winning.
- **15,000-subscriber email list** + ~140k+ Facebook followers. If Orca
  Network advocates, uptake is real.

## The one true gap

The whole strategy rests on a partner we don't yet understand well enough.
**Next move is discovery, not engineering:** talk to Howard Garrett & Susan
Berta to learn their actual curation workflow, where the pain is, and what
they'd value. Open questions captured in `research/questions.md`. Picking the
offer without that is guessing.

## What was explicitly NOT chosen (paths considered and set aside)

- **Cross-post outward / ingest inward / bridge both ways** — set aside in favor
  of the partnership-led framing (integration becomes a *feature of* the
  partnership, not the strategy itself).
- **Make-the-site-welcoming-to-newcomers** — the user's other stated idea;
  deprioritized relative to winning the shore regular first. Newcomer onboarding
  matters more once the map is populated and the partnership gives it gravity.
