# 086 — What we know now is published as a file to poll; nothing is pushed until a subscriber asks

**Status:** accepted · **Decided:** 2026-10-21, by Peter · **Work:** GitHub [#738](https://github.com/salish-sea/salishsea-io/issues/738) (the file), [#739](https://github.com/salish-sea/salishsea-io/issues/739) (our sightings into Acartia) · **Relates:** [003](003-dwc-export-pipeline.md) (the archive this complements), [056](056-the-logged-out-read-path-is-built-as-static-files.md) (the day files and the manifest), [080](080-a-sighting-is-unconfirmed-until-someone-else-agrees.md) (the confirmation status the file carries), [docs/rights-policy.md](../rights-policy.md) (why Maplify's time is a report time)

## Context

The Darwin Core archive serves people who want the record: GBIF, researchers, anyone asking what was seen over years. A different kind of consumer wants to know what is happening now: a vessel-alerting tool, a notifier for shore watchers, anyone deciding where to look or where not to steer in the next hour. The question was whether to complement the archive with an interface for them, and the first idea was a data file plus an SNS topic.

Most of such an interface already exists. The build rewrites the day files, `/read-path/days/<YYYY-MM-DD>.json`, within about five minutes of any change, and `/read-path/manifest.json` carries the time of the snapshot that produced them; the site itself polls the manifest every minute and refetches the day when it moves (decision 056). Nothing stops a downstream system doing the same today. What it lacks is a contract: the day files carry the frontend's own row shape, which 056 chose on purpose so that the files and the page parse the same thing, and that shape changes whenever the frontend needs it to. A public consumer that bound itself to it would either break when the site moved or freeze the site.

Two facts about currency shape what such an interface can honestly be.

First, almost everything we publish reaches us late, and one source does not record when the animals were seen at all. Maplify keeps a single timestamp, the moment it received the report; the rights policy's ALIGN-05 already refuses to emit it at better than day precision in the archive for that reason. Orcasound bouts are curated by a moderator hours or days after the fact (decision 013). iNaturalist observations are uploaded after the outing. Only our own contributors' sightings are recorded when they happen. A feed that showed a Maplify report at second precision to a ship's bridge would assert a time we do not know.

Second, the region's real-time avoidance system already exists upstream of us. Orca Network's reports flow through Acartia, the cooperative this project belongs to, into Ocean Wise's Whale Report Alert System (WRAS) and on to Conserve.io and Maplify, where we fetch them. Most of what a feed of ours would carry is that data coming back round. The strategy for community uptake says it plainly: avoid rebuilding what Acartia already does. The one thing we originate that WRAS never sees is our own contributors' sightings, and the route for those is into Acartia, not out of a topic of ours.

## Decision

**A file of recent occurrences, with a documented and versioned schema, written by the build beside the day files.** It holds a rolling window of the last day or two, chosen in #738, and says when it was built. Each row carries what a consumer acting now needs and the day files leave implicit: the provider; whether the time is when the animals were observed or when the report arrived, which for every Maplify row is the report; the confirmation status of decision 080, so unconfirmed reports are flagged rather than dropped; the reported accuracy or null, never a made-up number; and a bout's end time. It is a separate file so that the frontend's shape and the public contract can move independently. The window is a convenience, not a fix: Peter judged the Pacific-day boundary, which splits a night's reports across two day files, not a problem worth solving, and a consumer may read two day files as easily as one.

**The manifest is the change signal, and polling is the protocol.** The site already works this way. Caddy answers conditional requests on these files, so a consumer that polls once a minute transfers nothing while nothing has changed.

**Nothing is pushed until a named subscriber asks.** No SNS topic, no webhooks, no WebSub. The posture matches PRODUCT.md, which puts real-time push notifications out of scope for people; this extends it to machines, with the door open. An SNS topic in particular is cheap to run and awkward to consume: a subscriber needs an AWS identity or an HTTPS endpoint that completes a confirmation handshake, and the build runs on Fly, so publishing would mean widening the Fly machine's AWS credentials beyond the two buckets the store writer may touch today. When a consumer exists, its needs choose the mechanism.

**The file says what it is not.** Its documentation states the latency of each source and that this is a view of what SalishSea.io has learned, minutes to days after the fact, not a ship-strike product. That is true of the map too, and the map's reader can see the timestamps; a machine's cannot unless told.

**Our own sightings' route to WRAS is Acartia**, which is #739's question and deliberately not this file's. It is blocked on a license rather than on plumbing: Acartia's contributors assert CC-BY 4.0, and our contributors consented to CC-BY-NC 4.0 (rights policy D-08). The options and who decides are in that issue; the rights policy is authoritative and would be amended by the outcome.

## Rejected

- **An SNS topic now.** Nobody has asked to subscribe. Building a push channel ahead of its consumer picks the mechanism before the need, and the first consumer may well not be on AWS.
- **Document the day files as the public contract instead of writing a new file.** It would bind the frontend's row shape, which decision 056 chose for the frontend's convenience, to outside readers. A separate file costs one more build task and keeps the two free to differ.
- **Re-broadcast Maplify as a real-time source.** Maplify's time is a report time, and the records are WRAS's own, coming back round. A feed that presented them as current observations would mislead exactly the consumer it was built for.
- **Leave it at the archive.** The archive is rebuilt for GBIF and says nothing about the present; a consumer reading it for currency gets yesterday's day at day precision.

## Consequences

- The build gains one task and one file, and `docs/` gains a page describing the schema and the latency (#738). The Stelis graph in `src/salishsea.rkt` names the task.
- The schema is versioned from its first publication, since outside readers will bind to it; a breaking change means a new version beside the old, not an edit in place.
- The rights policy gains a question it did not have: whether, and under what consent, native sightings may leave for a CC-BY cooperative (#739). Until it is answered, nothing we originate reaches WRAS.
- PRODUCT.md's out-of-scope entry for real-time push now cites this record, so the next person to propose a topic finds the reasoning and the condition under which it changes.
