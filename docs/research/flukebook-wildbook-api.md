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

## 6. Model / weights availability (for the self-host / architecture-B question)

Researched 2026-07-02, corrected/verified 2026-07-03. Bottom line up top: **a downloadable, orca-capable trained MiewID model exists** — but it is an *older generation (v3)* than the model production Flukebook actually runs (*v4*). So architecture B is **viable for orca with public models**, but the self-hoster runs **older public weights, not Flukebook's production weights**, with two further caveats: (i) the MiewID weights carry **no stated license**, and (ii) the fin-specific matchers (CurvRank v2, PIE, Kaggle7) are distributed as runtime downloads from Wild Me's public Azure CDN rather than clearly-licensed release artifacts.

Distinguish **code open-source** (nearly all of it is: Apache-2.0 / MIT / AGPL) from **usable trained weights available to download** — the table below is about the *weights*.

### Version reconciliation: "MiewID v4" (Flukebook) vs "msv3" (HuggingFace)

These are **different generations, not the same artifact.** Wild Me's naming: `msvN` = "multispecies **v**N". Confirmed mapping (as of 2026-07-03):
- HuggingFace `conservationxlabs/miewid-msv2` = MiewID **v2** (54 species, updated Oct 2024; the architecture in the 2024 arXiv paper).
- HuggingFace `conservationxlabs/miewid-msv3` = MiewID **v3** (64 species, updated Feb 2025).
- **MiewID v4** = the model deployed to Flukebook/Wildbook in Jan–Feb 2026 — trained on ~90 species / 110 feature classes, "40% more data … from public **and private** mark-recapture catalogs," explicitly "replacing MiewID v3." **v4 is NOT published on HuggingFace** — the `conservationxlabs` org lists only 2 models (msv2, msv3) and no msv4 as of 2026-07-03. (Source: MiewID v4 announcement + HF org page.)

So the newest **publicly downloadable** MiewID is **v3 (msv3)**; the model **production Flukebook runs is v4**, which is not downloadable. A self-hoster gets v3.

| Algorithm | Trained weights downloadable? | Where | Covers orca? | Weights license |
|---|---|---|---|---|
| **MiewID (public: v2/v3)** — *note: Flukebook runs **v4**, not published* | **Yes for v2/v3; NO for v4** | HuggingFace `conservationxlabs/miewid-msv2` (54 sp, Oct 2024), `miewid-msv3` (64 sp, Feb 2025) — `model.safetensors`, 51.4M params. **v4 (Flukebook prod) unavailable.** | **Yes (v3)** — msv3 eval lists `orca` mAP 77.7 / rank-1 86.0; humpback 70.5; greywhale 84.0. Paper (v2 data): orca = 4,045 annots / 1,208 individuals, 85.1% top-1 multispecies | **Unstated** — no `license` field on the HF card or API metadata (`tags: []`) |
| **PIE / PIE v2** | Partial / unclear | Code Apache-2.0 (`WildMeOrg/wbia-plugin-pie-v2`); pretrained weights pulled by WBIA at runtime from the Azure CDN (below). A `whale_shark` example ships; a standalone downloadable **orca** PIE model is **not documented** | Humpback PIE runs on Flukebook's backend; orca PIE weight as a public download: **not documented** | Code Apache-2.0; weights license unstated |
| **CurvRank / CurvRank v2** | Yes, via CDN | `WildMeOrg/wbia-plugin-curvrank` + `wbia-tpl-curvrank-v2` (wraps `hjweide/dolphin-identification`); weights/test DBs fetched from `wildbookiarepository.azureedge.net` (e.g. `.../databases/testdb_curvrank.zip`) | v2 was retrained on ~5,000 multi-species dorsal fins incl. orca (per Wild Me); no clean per-species model card | Weights license unstated |
| **HotSpotter** | N/A (no learned weights) | In WBIA core; SIFT features + LNBNN, no trained CNN. Runs fully offline | Species-agnostic pattern/texture matcher (usable for saddle-patch/texture) | Code AGPL (WBIA) |
| **finFindR** | Yes (in Docker image) | Separate container `wildme/wbia-plugin-finfindr` (wraps `haimeh/finFindR`); weights baked into the image | Dorsal-fin edges; tuned for dolphins — orca applicability undocumented | See `haimeh/finFindR` repo; weights license unstated |
| **Deepsense / Kaggle7** | Via CDN (not standalone) | Kaggle humpback-fluke competition winners integrated into WBIA; weights fetched from the Azure CDN at runtime; **no standalone HF release** | No — **humpback-fluke only** | Unstated; original Kaggle competition terms may apply |

**Runtime model download / phone-home:** WBIA does **not** bundle most model files. It **downloads them on first run** from Wild Me's public CDN **`https://wildbookiarepository.azureedge.net/…`** (model/database `.zip`s, e.g. `testdb_curvrank.zip`, `wd_peter2.zip`), then **caches them in a mounted `/models` volume; after that the pipeline runs offline** — the docker docs state caching "eliminates Azure dependencies after initial download." So: a one-time fetch from a **public, unauthenticated CDN**, not a per-request phone-home, and no live dependency on a Wild Me match endpoint once cached. (MiewID is the exception — pulled from HuggingFace via `AutoModel.from_pretrained(...)`, also cacheable/offline after first pull.)

**Training-data provenance / restrictions:** MiewID's training set is "a combination of data from Wildbook platforms (multiple users), Happywhale Kaggle competition multispecies dataset, and multiple publicly available datasets"; the paper says data was "either publicly available or directly contributed to Wild Me via our hosted Wildbook platforms," where contributors retain permissions. A **subset** is published at lila.science. The full training data is **not** redistributable, and the **Happywhale Kaggle** portion carries competition-use terms — relevant if you retrain, less so if you only run inference. The **weights' own license is unstated**, which is the material legal gap for production use.

**Does Flukebook actually run the public models?** Separate three claims, because the strength of evidence differs sharply:
- **(a) Flukebook *lists* MiewID/CurvRank/PIE as supported** — confirmed (wildme.org/flukebook.html, release notes).
- **(b) Flukebook *runs* MiewID (v4) and CurvRank in production for matching** — confirmed (Wildbook 10.9.0 release notes + MiewID v4 announcement say v4 was deployed to Flukebook and "replaced v3" Jan–Feb 2026).
- **(c) the exact weights Flukebook runs are the SAME artifacts on HuggingFace / the CDN that a self-hoster downloads** — **NOT confirmed; primary sources indicate the opposite for MiewID.** Flukebook runs **v4**; the public HF release is **v2/v3**. The plugin selects its model at runtime from a deployment-side config (`/v_config/miewid/model_config.json`, loaded in `wbia_miew_id/_plugin.py`) that is **not in the public repo**, so there is no repo-pinned HF revision proving byte-identity. For CurvRank/PIE/Kaggle7, the CDN artifacts are plausibly what production pulls, but I found **no primary source stating Flukebook's production weights are byte-identical to any public HF/CDN artifact.** Treat (c) as **unconfirmed**.

### Wild Me team confirmations (WILDLABS Q&A, ~early 2024)

From a Wild Me team Q&A (WILDLABS "Variety Hour" write-up; the Notion asset link embeds a late-March-2024 expiry, so this is **~early 2024** — predates v4). Read directly in-browser (the page 403s automated fetch):

- **MiewID is unambiguously the production matching pipeline** for Wildbook/Flukebook — stated twice by the team, pointing at `github.com/WildMeOrg/wbia-plugin-miew-id`. Architecture: **CNN backbone (default `efficientnetv2_m`) + metric-learning head** — embedding similarity, not a classifier. Confirms claim (b) from a first-party voice.
- **It is human-in-the-loop, NOT autonomous.** The team's own words: the model "is not autonomous, but it can make your life a hell of a lot easier in searching through match candidates." A query returns **ranked candidate matches a human reviews and chooses from.** *Direct design consequence for us:* CV output is always a **candidate identification**, never an auto-assigned `organismID` — reinforces the validation model (beads `ek3`) and the "candidate identifier" concept.
- **Dorsal-fin species need very little data.** For species "identified by a dorsal fin," a multispecies model can work with "as low as 0 to a couple of samples," because such animals are visually distinctive. Supportive for **orca** (dorsal fin + saddle patch), though the team did **not** name orca or give an orca number here.
- **Scale context:** they cite a "current Flukebook **21 species** model" (early 2024) and a ~50-species model in progress — consistent with v4's later ~90 species. Leave-one-out on *unseen* species: "80% of species get a correct match in the top-20, 80% of the time" — a candidate-surfacing aid, not an identifier.

Net: this **strengthens (b)** (MiewID is production, first-party confirmed) and adds the **human-in-the-loop** design fact, but does **not** resolve (c) (weights parity) or give an orca-specific production accuracy — both still require Wild Me.

**Orca specifically — which model does Flukebook invoke?** Orca is a **trained species in both** the public msv3 (eval table) and, per the v4 announcement, the deployed v4 (~90 species incl. cetaceans/fins). CurvRank v2 also covers orca dorsal fins. **But which algorithm+model Flukebook actually invokes for an orca annotation today** — MiewID v4 vs CurvRank v2, or a per-species pipeline choice — is **not stated in any primary source I found.** (The 2019 IWC doc's "orcas manually matched" is stale.) I will not infer it; **verify with Wild Me** for the current orca pipeline.

**Verdict on architecture B for ORCA:** *Viable with public models, but you would run older weights than Flukebook.* You can self-host WBIA and run **MiewID v3 (msv3)** — a genuinely downloadable model whose published eval includes orca (~77–85% depending on metric) — plus fetch **CurvRank v2** orca dorsal-fin weights from the public CDN, all runnable offline after first download. Two honest limits: (1) this is **not** Flukebook's production model (that's the unpublished v4), so expect *somewhat lower* accuracy than hosted Flukebook; and (2) the blocker on top of availability is **licensing clarity** — the trained weights ship with **no stated license**, so a production/commercial deployment needs written confirmation from Wild Me on weight-reuse terms before relying on them.

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
- <https://wildlabs.net/discussion/faces-flukes-fins-and-flanks-how-multispecies-re-id-models-are-transforming-wild-mes> — WILDLABS Q&A with the Wild Me team (~early 2024; 403s automated fetch, read in-browser 2026-07-03): MiewID is the production matching pipeline (efficientnetv2_m backbone + metric-learning head); human-in-the-loop candidate suggester, "not autonomous"; dorsal-fin species need ~0–few samples; "current Flukebook 21 species model" (early 2024).
- <https://huggingface.co/conservationxlabs/miewid-msv3> — MiewID msv3 model card: 64 species incl. `orca` (mAP 77.7 / rank-1 86.0), humpback, greywhale; `model.safetensors` (51.4M params); training data = Wildbook + Happywhale Kaggle + public datasets.
- <https://huggingface.co/api/models/conservationxlabs/miewid-msv3> — HF API metadata: **no `license` field** (weights license unstated); siblings include `model.safetensors`.
- <https://huggingface.co/conservationxlabs/miewid-msv2> — MiewID msv2 (54 species) predecessor.
- <https://arxiv.org/html/2412.05602v1> — MiewID multispecies paper: orca = 4,045 annotations / 1,208 individuals; orca+fin_dorsal 5,781/1,494; 85.1% top-1 multispecies vs 74.9% single-species; data "publicly available or contributed to Wild Me."
- <https://github.com/WildMeOrg/wbia-plugin-miew-id> — MiewID WBIA plugin; loads `conservationxlabs/miewid-msv*` via `AutoModel.from_pretrained`. (Zenodo 1.0.1: <https://zenodo.org/records/13647526>.)
- <https://github.com/WildMeOrg/wbia-plugin-pie-v2> — PIE v2 plugin, code Apache-2.0; ships a whale_shark example; no documented standalone orca weight.
- <https://github.com/WildMeOrg/wbia-plugin-curvrank> and <https://github.com/WildMeOrg/wbia-tpl-curvrank-v2> — CurvRank/CurvRank v2 plugins (wrap `hjweide/dolphin-identification`); weights fetched from the Azure CDN.
- <https://github.com/WildMeOrg/wbia-plugin-finfindr> — finFindR plugin: separate Docker container `wildme/wbia-plugin-finfindr` wrapping `haimeh/finFindR`; weights in the image.
- `wildbookiarepository.azureedge.net` (public Wild Me CDN) — WBIA downloads model/database `.zip`s on first run (e.g. `databases/testdb_curvrank.zip`, `databases/wd_peter2.zip`), cached in `/models`; docker docs note this "eliminates Azure dependencies after initial download" → offline after first fetch. Referenced from `WildMeOrg/wildbook-ia` and plugin constants.
- <https://lila.science/datasets> — hosts a published **subset** of the MiewID training data (full set not redistributable).
- <https://community.wildme.org/t/miewid-v4-announcement/5406> — **MiewID v4 announcement**: v4 trained on ~90 species / 110 feature classes, "40% more data … from public **and private** mark-recapture catalogs," "replacing MiewID v3"; links msv3 HF repo as the *past* (v3) model. Establishes v4 ≠ msv3 and v4 is not published.
- <https://huggingface.co/conservationxlabs> — org page lists **only 2 models** (miewid-msv2, Oct 2024; miewid-msv3, Feb 2025) — **no msv4** as of 2026-07-03. Confirms the Flukebook-deployed v4 is not publicly downloadable.
- `WildMeOrg/wbia-plugin-miew-id` `wbia_miew_id/_plugin.py` (<https://github.com/WildMeOrg/wbia-plugin-miew-id>) — model repo/revision is **not hardcoded**; loaded at runtime from deployment config `/v_config/miewid/model_config.json` (+ `model_bin_config.json`). No repo-pinned HF revision → cannot prove production weights = public artifact. Repo code-search for `msv3` returns 0 hits.
- <https://community.wildme.org/t/miewid-v4-cross-side-matching-coming-to-iot-monday-feb-2/5410> — v4 + cross-side matching deployment timing (Feb 2026).
