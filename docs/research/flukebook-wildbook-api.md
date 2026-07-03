# Flukebook / Wildbook API — integration research

**Research date:** 2026-07-02 · **Author:** engineering spike (AI-assisted) · **Status:** background/reference

## Executive summary

Yes, an integration is technically possible, but it is **not a clean public API integration**. Flukebook is a hosted deployment of the open-source **Wildbook** Java web app, backed by **Wildbook-IA (WBIA)**, the computer-vision service that actually runs the matching. Neither piece exposes a documented, self-serve public API for third-party platforms. The realistic shapes are: (1) **become a Flukebook contributor** — request an account and push encounters/photos in via the web submit form or the spreadsheet-based **Bulk Import** path, letting Flukebook's automated pipeline do the matching and getting results back through the Wildbook UI/notifications and its read-only query API; or (2) **self-host Wildbook + WBIA** (both AGPL open source) and call WBIA's REST job engine directly. There is **no documented turnkey "POST a photo, poll for individual-match JSON" public endpoint on flukebook.org** — programmatic write access at that level requires a conversation with Wild Me / Conservation X Labs. Flukebook is **actively maintained as of 2026** (Wildbook 10.9.0 was deployed to Flukebook in Jan 2026). Flukebook and Happywhale are **separate platforms with separate identity spaces** — confirmed; no shared individual IDs.

---

## 1. API surface

Two distinct components, and it matters which one you mean:

### Wildbook (the Java web app) — what an external contributor talks to
- Flukebook.org runs the **Wildbook** Java/Tomcat application (`org.ecocean.*`). Source: <https://github.com/WildMeOrg/Wildbook>.
- It exposes a **read/query REST servlet**, `org.ecocean.servlet.RestServlet`, mapped under **`/rest/`**. Behavior, from the source:
  - `GET /rest/{className}` — list/query objects of a persistent class (e.g. `org.ecocean.Encounter`, `org.ecocean.MarkedIndividual`).
  - `GET /rest/{className}/{id}` — fetch one object by id.
  - **JDOQL** queries via a `query=` URL param (`SELECT FROM ... WHERE ...`), URL-decoded server-side.
  - Declared verbs are GET/POST/PUT/DELETE/HEAD, **but the running `service()` method only handles GET and HEAD** — it returns `SC_METHOD_NOT_ALLOWED` for the rest. So in practice this is a **read/query API, not a write API**.
  - **Auth:** container-managed — `req.getUserPrincipal() == null → 401`. You need a Wildbook **login** (username/password / session); `User` and `Role` classes are explicitly blocked from the API.
  - **Format:** JSON (DataNucleus serialization, with per-class `decorateJson()`/`sanitizeJson()` hooks), gzip on large payloads.
  - This is exactly what the **`RWildbook`** CRAN package wraps (username/password + a Wildbook base URL). Source: `RestServlet.java` on `WildMeOrg/Wildbook`; `RWildbook` on CRAN.
- **Writing data (contributing encounters/photos)** is *not* done through that REST servlet. The documented paths are the **web submit form** (`https://www.flukebook.org/submit.jsp`) and **Bulk Import** (spreadsheet + media; instructions at `https://www.flukebook.org/import/instructions.jsp`). Both are UI/workflow-driven, not a documented machine API.
- The **Dec 2025 release (Wildbook 10.9.0)** added "a new user interface and **API** for Encounter details and the Encounter search-results tabs" (React front-end). This is an **internal app API**, not a published third-party contract — treat it as undocumented/unstable for integration purposes.

### Wildbook-IA / WBIA (the CV backend) — what does the matching
- **WBIA** (formerly IBEIS) is a **Flask REST service** with a background **job engine**. Source: <https://github.com/WildMeOrg/wildbook-ia>, package `wbia.web` (`apis.py`, `apis_engine.py`, `apis_query.py`, `apis_json.py`, `job_engine.py`).
- The match model is **async / background-job**: you submit to an engine endpoint, get back a **`jobid`**, then poll for results (optional `callback_url`/`callback_method`/`callback_detailed`; a `lane` param `fast`/`slow` prioritizes queueing). Representative endpoints (from `apis_engine.py`):
  - `POST /api/engine/detect/cnn/...` (e.g. `/yolo/`, `/lightnet/`) — detection → Annotations.
  - `POST /api/engine/query/graph/` , `/api/engine/query/annot/rowid/` — identification/matching jobs.
  - `POST /api/engine/image/json/` — import images from URIs.
  - `POST /api/engine/wildbook/sync/` — sync back to the Wildbook Java app.
  - Synchronous query variants exist too (`apis_query.py`): `/api/query/chip/dict/`, `/api/query/graph/v2/` (POST create / GET sync / PUT add / DELETE), `/api/status/query/graph/v2/`.
- **This is the backend service.** On flukebook.org it sits *behind* the Java app; you would only call WBIA directly if you **self-host**. There is no indication flukebook.org exposes WBIA to the public internet.

**Bottom line for Q1:** REST on both tiers. The public-facing Wildbook `/rest/` API is read-only + login-gated (JDOQL query). The async match engine lives in WBIA and is an internal/self-host concern. No documented public "submit photo → poll match JSON" endpoint on flukebook.org.

## 2. Algorithms & species

Flukebook advertises multiple pipelines; the algorithm depends on species and body feature. Primary sources: the IWC cross-reference (SC/68B/PH/01), the Springer 2021 Flukebook paper, wildme.org/flukebook.html, and the community forum.

Named algorithms in the ecosystem: **HotSpotter** (SIFT texture/pattern), **CurvRank / CurvRank v2** (curvature of a trailing edge), **finFindR** (dorsal-fin edge), **PIE / PIE v2** (Pose-Invariant Embeddings, deep), **Deepsense** and **Kaggle-7** (kaggle-winning fluke models), **DTW**, and **MiewID** (**MiewID v4 deployed to Flukebook Jan 2026**, multi-species embeddings with viewpoint-aware matching).

Feature ↔ species mapping relevant to the Salish Sea:
- **Humpback (Megaptera novaeangliae) → fluke.** Multiple algorithms (feature-based + deep): CurvRank on the fluke trailing edge, plus deep fluke matchers (Kaggle-7 / Deepsense / PIE / MiewID). The IWC table lists humpback as "Fluke (x3 algorithms)". Reported accuracy varies: e.g. Kaggle-7 top-1 ~93% / top-5 ~97% against a 4,511-whale Cascadia catalog; CurvRank top-1 ~80% (Weideman et al. 2017).
- **Orca / killer whale (Orcinus orca) → dorsal fin + saddle patch.** CurvRank v2 was retrained on ~5,000 hand-traced multi-species dorsal fins (explicitly including orcas); MiewID/PIE also apply. **Caveat:** as of the 2019 IWC cross-reference, orcas on Flukebook were largely **stored and manually matched** ("actively being used this way for Orcas and fin whales"); dedicated orca AI matured afterward. wildme.org/flukebook.html currently lists Orcinus orca as a supported species. Confirm the *current* orca pipeline and accuracy directly with Wild Me before relying on it.
- **Gray whale (Eschrichtius robustus)** and **minke (Balaenoptera acutorostrata):** listed by wildme.org/flukebook.html among supported species, but I found **no primary-source algorithm/accuracy detail** for either. Treat as "supported/possible, specifics undocumented — verify with Wild Me."

The Springer paper's headline figure (open-access abstract): **7 automatic ID algorithms trained for 15 species → 37 species-specific pipelines.** (Number will have grown; the paper is 2021.)

## 3. Two-way / data sharing & contribution

- Flukebook is explicitly a **shared community platform**: "PhotoID … finds power in numbers and international, inter-institutional collaboration." Contribution paths: **web submit** (`submit.jsp`), and **Bulk Import** in "Wildbook standard Excel format" + media (`import/instructions.jsp`). So yes, an external platform can contribute encounters and photos — a **bulk import path exists**.
- **Rights/licensing:** per the IWC cross-reference, **"All data rights remain with contributor."** Access is "open to all for data submission," but *data curation requires an administered login account*. Data visibility defaults to the contributor and is shared only by explicit User- or Organization-level permission; cross-boundary access is blocked/prompts collaboration. **No cost** to upload or maintain data. There is **no CC-style automatic public licensing** on Flukebook (contrast Happywhale, which offers per-image Creative Commons settings).
- Implication for SalishSea.io's own DwC-A/aggregator model (see `docs/data-provenance.md`, `docs/rights-policy.md`): contributing *into* Flukebook is a permissioned, contributor-retains-rights arrangement — compatible in principle, but any two-way flow (pulling Flukebook individual IDs back into our catalog) needs an explicit data-sharing agreement, not just an API key.

## 4. Identifiers & dedup

- Wildbook object model (`org.ecocean.*`): **Encounter** (a sighting of an animal, with media) → **Annotation** (a CV bounding box/feature region within an image, produced by detection) → matched into a **MarkedIndividual** (the catalog identity). **Sighting/Occurrence** groups encounters of possibly multiple animals at one time/place. Matching operates at the **Annotation** level; identity is assigned at the **MarkedIndividual** level.
- **Individual identifiers:** a MarkedIndividual has an internal **UUID** plus one or more human **names / catalog nicknames** (individuals can carry *multiple* catalog IDs — the IWC doc notes whales with "eight different catalog IDs" reconciled across catalogs). So mapping a Flukebook individual to our catalog = store the Flukebook **MarkedIndividual UUID + display name** as an external identifier alongside our own id; do not assume 1:1.
- **Dedup vs Happywhale:** **Flukebook and Happywhale do NOT share an identity space — confirmed** (IWC SC/68B/PH/01). They are separate platforms, separate catalogs, separate CV backends (Happywhale uses its own fluke matcher; Flukebook uses Wildbook/WBIA). Happywhale itself *reconciles* multiple external catalog IDs onto one animal ("multiple IDs across multiple reconciled catalogs"), but that reconciliation is internal to Happywhale and not exposed as a shared Flukebook↔Happywhale key. **Cross-platform dedup must be done by us** (photo/CV or manual expert matching), not by a shared identifier. There is no common UUID space to join on.

## 5. Hosting / access / governance

- **Both hosted and self-hostable.** Flukebook.org is a **free hosted service** operated by **Wild Me (now part of Conservation X Labs)**; you **"Request An Account"** via a contact form (`https://www.wildme.org/contact/`). Wildbook core and WBIA are **open source (AGPL)** and self-hostable (Docker), so you *can* stand up your own instance + CV backend if you need direct WBIA access.
- **Rate limits / cost / programmatic access terms:** **not documented publicly.** No cost to upload/store data on hosted Flukebook. Programmatic (API) access beyond the login-gated read API and bulk-import is **not a self-serve offering** — it requires contacting Wild Me. Do not assume any published rate limit; unknown.
- **Governance / maintenance state (2026):** Wild Me and **Conservation X Labs merged, announced 2024-01-09** (Jason Holmberg → CXL Chief Data Officer). Wild Me operates as a lab within CXL. The software is **actively maintained**: **Wildbook 10.9.0** (Dec 2025, DOI 10.5281/zenodo.17979947) was **deployed to ~12 Wildbooks including Flukebook, MantaMatcher, GiraffeSpotter between Jan 15–26, 2026**. Flukebook is operating and current.

---

## Decision-relevant flags

- **No turnkey public match API on flukebook.org.** The clean "POST photo → poll for individual match" model only exists if you **self-host WBIA**. Against hosted Flukebook, integration = contributor account + bulk/submit import + read-only login API + a data-sharing conversation with Wild Me. Budget for that conversation; don't design around an API that isn't published.
- **Async job model** is inherent to WBIA (jobid + poll/callback). Any direct-WBIA design must be queue/poll, not request/response.
- **Orca AI is the weak spot in the primary record.** Humpback fluke matching is well-established; orca dorsal/saddle and gray/minke specifics are under-documented in primary sources and partly historical ("manual" as of 2019). Verify current orca capability/accuracy with Wild Me before committing.
- **Flukebook ≠ Happywhale identity space** — no shared IDs; cross-dedup is our problem. Both do CV photo-ID on the same Salish Sea animals, so double-contribution/duplication risk is real and must be managed deliberately.

## Stale / version-dependent notes

- IWC **SC/68B/PH/01** cross-reference is **~2019** — its "orcas are manually matched," catalog sizes, and "35,000 Happywhale individuals" figures are outdated; used here for the *structural* claims (separate platforms, data-rights model, feature/species mapping), not current numbers.
- Springer Flukebook paper is **2021** ("7 algorithms / 15 species / 37 pipelines" has since grown).
- The `RestServlet.java` behavior was read from the repo `main` branch on 2026-07-02; verify against the exact Flukebook release if building against it.
- WBIA docs site self-labels as `4.0.1.dev*`; endpoint list read from `main`. `MiewID v4` landed on Flukebook Jan 2026 — newest and likely still evolving.

## Sources

- <https://github.com/WildMeOrg/Wildbook> — Wildbook Java web app source (the app Flukebook runs); `org.ecocean.*`.
- `RestServlet.java` (`WildMeOrg/Wildbook`, `main`) — the `/rest/` read/query API: GET/HEAD only in practice, JDOQL `query=` param, `getUserPrincipal` auth, JSON out, User/Role blocked.
- <https://github.com/WildMeOrg/wildbook-ia> — WBIA (CV backend, Flask + job engine); `wbia.web` package.
- <https://wildmeorg.github.io/wildbook-ia/api.html> — WBIA module/API docs (confirms `apis`, `apis_engine`, `apis_query`, `apis_json`, `job_engine`, `apis_sync`, `routes`).
- `wbia/web/apis_engine.py` and `apis_query.py` (`WildMeOrg/wildbook-ia`, `main`) — concrete async engine endpoints (`/api/engine/detect/...`, `/api/engine/query/graph/`), `jobid` + callback/lane model; sync `/api/query/...` and graph-v2 routes.
- <http://www.wildme.org/wildbook/javadoc/5.x/org/ecocean/servlet/RestServlet.html> — Javadoc index entry for RestServlet (page 404'd on fetch; class confirmed via source).
- <https://cran.r-project.org/web/packages/RWildbook/index.html> — RWildbook wraps the Wildbook REST API with username/password + base URL (evidence the `/rest/` API is the sanctioned read path).
- <https://link.springer.com/article/10.1007/s42991-021-00221-3> — Flukebook (Blount et al. 2021), "7 algorithms / 15 species / 37 pipelines," open-source AI platform (full text paywalled; abstract used).
- IWC **SC/68B/PH/01**, "A Cross-reference of Flukebook and Happywhale Platforms" (Olson, Blount, Cheeseman, Holmberg, Minton) — <https://arabianseawhalenetwork.org/wp-content/uploads/2020/06/sc_68b_ph_01_flukebook-and-happy-whale-platform-comparison-1.pdf> — separate platforms/catalogs; data-rights ("all data rights remain with contributor"); species↔feature↔algorithm table; bulk import (`import/instructions.jsp`), submit (`submit.jsp`); orcas manually matched as of 2019.
- <https://www.wildme.org/flukebook.html> — Wild Me's Flukebook page: "Request An Account," free hosted, supported species incl. Orcinus orca / Megaptera novaeangliae / Eschrichtius robustus / Balaenoptera acutorostrata; algorithms MiewID, PIE v2, HotSpotter, CurvRank v2, Deepsense, DTW, Kaggle7, finFindR.
- <https://www.flukebook.org/> — running instance: login, Report an encounter, Bulk Import; supported cetaceans; collaboration framing.
- <https://community.wildme.org/t/wildbook-release-notes-10-9-0-december-2025/5344> — Wildbook 10.9.0 (Dec 2025), DOI 10.5281/zenodo.17979947, deployed to Flukebook + 11 others Jan 2026; new Encounter details/search API (internal). Evidence of active 2026 maintenance.
- <https://community.wildme.org/t/miewid-v4-for-flukebook-and-cross-side-matching/5496> — MiewID v4 deployed to Flukebook Jan 2026, viewpoint-aware matching.
- <https://www.conservationxlabs.com/news/conservation-x-labs-and-wild-me-announce-merger> — CXL/Wild Me merger (2024-01-09); Holmberg → CXL Chief Data Officer.
- <https://news.mongabay.com/2024/01/conservation-x-labs-announces-merger-with-ai-nonprofit-wild-me/> — independent confirmation of the merger.
- <https://wildbook.docs.wildme.org/data/search.html> — Wildbook search is documented as a **UI** feature (Encounter/Individual/Sighting search + export tab); no public REST/JSON search API documented there.
- <https://happywhale.com/> — Happywhale (separate platform; own CV photo-ID; own catalog/identity space).
