# 034 — A profile URL keys on the register identifier; the designation is a slug

**Status:** accepted · **Decided:** 2026-08-30 · **Amends:** [015](015-individual-profile-pages.md), [016](016-matriline-profile-pages.md), [017](017-ecotype-profile-pages.md)

## Decision

A profile URL keys on the register's `entity_id`. The designation stays in the URL as a slug that is composed by us, shown to people, and **ignored on read**.

```text
/individuals/0010193/T065A       SSA:0010193
/ecotypes/0000002/Biggs          SSA:0000002
/matrilines/0002039/T073s        SSA:0002039  — not yet, see "Sequencing"
```

The first segment after the family is the seven-digit local part of the identifier, which is [ADR-0021](https://github.com/salish-sea/animals/blob/main/decisions/0021-ssa-is-a-registered-prefix.md)'s registered pattern `^\d{7}$`. It is the only part that is read.

**Designation paths keep working and redirect.** `/individuals/T065A`, `/individuals/T046A` and `/individuals/CA172` each `301` to the canonical form. A designation is what a person types, searches for and reads in a Facebook post; it stops being what the site keys on.

**A missing or stale slug redirects rather than 404s.** `/individuals/0010193` and `/individuals/0010193/T065A9` both `301` to `/individuals/0010193/T065A`, because the slug is never read and the canonical form is always derivable from the key. The bare identifier is therefore a working address without being the canonical one.

**The slug carries the conventional written form** — `T065A2`, not `t065a2`. Resolution is case-insensitive, so a typed lowercase path still redirects; only the canonical form we emit is cased. Where the register's label is not URL-clean, the slug is ours to compose: the register labels the ecotype `Bigg's` and the slug is `Biggs`.

## Why

**This is already broken in production, not a purity problem waiting to happen.**

```text
/individuals/T046A  →  the generic site card
/individuals/T122   →  "Centeki (T122)"
```

T046A was renamed to T122. `public.designations` records the rename in `superseded_by`, and the edge handler queries `primary_designation=eq.…`, so the old code resolves to nothing and fails open to the site card. **65 designations are dead as URLs today** — every non-primary code in the catalogue, mostly the `CA`/`AO` alternates from other catalogues, plus the one superseded code. Measured in production 2026-08-30.

Animals [ADR-0011](https://github.com/salish-sea/animals/blob/main/decisions/0011-label-is-a-preferred-name.md) says the register's label is "not an integration key — nothing may join, match, or key on `label` … Integrators key on `entity_id`, always", and [ADR-0012](https://github.com/salish-sea/animals/blob/main/decisions/0012-relationship-to-the-salishsea-io-catalogue.md) names our profile URLs as a live violation the migration has to address. The 65 dead URLs are what that violation looks like from outside.

**It gets worse if we wait.** ADR-0011's consequence section is explicit about the mechanism: "Changing a label is cheap and has no migration cost, because nothing keys on it. This only remains true if the 'not an integration key' rule is actually honoured — if a consumer starts matching on labels, it silently stops being true." [Q13](https://github.com/salish-sea/animals/issues/9) is open on whether the canonical written form of a matriline is `T090s` or `T090 matriline`, across 134 entities, and says the question is "cheap to change now and cheap to change later". Keying URLs on the label is precisely what would make it expensive — for them, by us.

**Now is the cheap moment.** [`sitemap.xml`](../../vite.config.js) declares only `/` and `/about.html`; no profile page has ever been submitted to a crawler as canonical. There is no declared canonical URL to invalidate, and that stops being true the first time one is.

## Sequencing: individuals and ecotypes now, matrilines when Q22 answers

This record can be implemented for two of the three families immediately, and the epic's issue graph did not reflect that.

The [reconciliation](../reference/register-reconciliation.md) resolves **510 of 510 individuals** to exactly one register entity, and the one ecotype. Groups are the exception: 73 of our 132 matriline rows are letter-suffixed sub-lineages the register has no group for, which is open upstream as [Q22](https://github.com/salish-sea/animals/issues/13) and tracked as `salish-ox2.6`. Until Q22 answers, a `/matrilines/` URL has no stable identifier to key on for 73 of 132 pages.

So `/individuals/` and `/ecotypes/` adopt this shape as soon as `public.individuals` carries `SSA:` identifiers, and `/matrilines/` follows without further debate once its identifiers are settled. This record is deliberately partially implemented in the interim; that is a sequencing fact, not an open question.

## Where the redirect happens

The viewer-request Lambda@Edge already intercepts these paths ([015](015-individual-profile-pages.md)), so the redirect belongs there — cacheable at CloudFront, and correct for crawlers.

**The canonical path costs no lookup.** An identifier-keyed URL is rewritten to the page shell exactly as today. Only a designation path pays a Supabase round trip to resolve, and those are the legacy and hand-typed ones.

**A failed redirect degrades to the shell, never to a 503.** 015 records why: the viewer-request function is hard-killed at 5s and CloudFront then serves a 503, so every Supabase call carries an `AbortSignal` deadline. A resolution that times out rewrites to the shell as today, and the page canonicalises client-side with `history.replaceState`. The edge redirect is an optimisation over a correct client, not a dependency.

## Consequences

- **`public.designations` does not dissolve into the register.** `T046A` appears in no register `label` and no `names` row — verified against edition 2026.08.1 on 2026-08-30 — because the register carries current names and this one was retired before it existed. Historical codes we hold and the register does not publish stay ours, and they are the input to the `301`. The same is true of `AO10` and `CA20` while [Q23](https://github.com/salish-sea/animals/issues/14) is open.
- **The slug is free to change, and changing it costs nothing.** Q13 can relabel all 134 matrilines and no URL moves; the old slug still resolves because it was never read. This is the whole point of the shape.
- **We become the de facto resolver for `SSA:` identifiers.** [ADR-0014](https://github.com/salish-sea/animals/blob/main/decisions/0014-a-publication-not-a-service.md) makes the register a publication and not a service, and ADR-0021 registered the prefix with no URI format and no provider. `https://salishsea.io/individuals/0010193` — which redirects to the slugged canonical form, per the rule above — is the first resolvable address these identifiers have had. That is a commitment: [ADR-0010](https://github.com/salish-sea/animals/blob/main/decisions/0010-identifiers-are-never-reused.md) promises identifiers are never reused, so the address can be permanent in a way a designation URL never was — and OrcaSound is about to store the same identifiers on bout tags ([orcasite#1001](https://github.com/orcasound/orcasite/issues/1001), [028](028-salishsea-io-speaks-to-orcasound.md)), where a tag can now link straight to a profile.
- **Two URLs address one page, so the shell carries a `<link rel="canonical">`** pointing at the identifier form. Without it the `301` fixes crawlers and the client-side fallback does not.
- **The prose linker is unaffected for readers.** [`injectIndividualLinks`](../../src/individual-links.ts) turns codes found in sighting text into profile links from a designation→individual map; it gains the identifier and emits the canonical path. A code that resolves to nothing still passes through as plain text — linking is a navigation aid, never an identification claim.
- **[`e2e/og-previews.spec.ts`](../../e2e/og-previews.spec.ts) asserts against production** and must assert both the canonical `og:url` and the `301`, or the smoke run will keep passing while the scheme is half-migrated.

## Alternatives considered

- **Keep the designation path and resolve it through the register's fold**, 301-ing a superseded code to its current one. The URL stays beautiful and the fix for the 65 dead codes is the same. Rejected because it is matching on a label at request time — the exact thing ADR-0011 says silently makes label changes expensive again — and because Q13 would then move 134 matriline URLs that this shape leaves untouched. It buys today's fix by keeping the violation.
- **Identifier only, no slug** — `/individuals/0010193`. Correct and unusable: the URL in a Facebook post is often the only context a reader gets, and `T065A` is the word people search.
- **The CURIE in the path** — `/individuals/SSA:0010193/T065A`. Copy-pastes both ways against the register and orcasite, which is a real advantage. Rejected because clients percent-encode the colon inconsistently and the Lambda sees the raw or encoded form depending on the sender; the route family already says what kind of thing it is, so the prefix earns nothing at the cost of a parsing hazard.
- **Defer the whole thing to `salish-ox2.5`.** Rejected on sequencing: ox2.5 is blocked by Q22, Q22 is waiting on people outside this project, and individuals — 510 of 510 resolved — are not blocked by any of it. The 65 dead URLs would wait on an answer that has nothing to do with them.

## Reference

Epic `salish-ox2`, issue `salish-ox2.2`. Measurement: [`docs/reference/register-reconciliation.md`](../reference/register-reconciliation.md). Names and display: [033](033-register-names-the-animals.md). Profile pages as they stand: [015](015-individual-profile-pages.md), [016](016-matriline-profile-pages.md), [017](017-ecotype-profile-pages.md).
