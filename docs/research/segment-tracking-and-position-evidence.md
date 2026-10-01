# Tracking theory and position evidence for travel segments

**Research date:** 2026-09-30 · **Author:** research spike (AI-assisted) · **Status:** background/reference

## Executive summary

The tracking literature says our next rule should do four things the current one does not. It should let each sighting's own uncertainty, and the time since a track was last seen, set how far a join may reach. It should choose between candidate tracks by how probable the new sighting is under each, always counting "this is a different group" as one of the candidates. It should decide a whole day at once, so a later sighting can settle an earlier ambiguity. And it should treat a reported ecotype as a barrier and a reported pod or matriline as strong but fallible evidence. None of this needs a full multi-target tracker.

The case behind [#445](https://github.com/salish-sea/salishsea-io/issues/445) shows why. On 3 September 2026 a track ended at an Orca Network report at 08:33 off the west side of San Juan Island. Scott Veirs's first sighting of his afternoon encounter, at 14:56, was 20.4 km from that point and was refused by the fixed 20 km limit. His 15:02 sighting, 1 km further west and 19.8 km away, was accepted, which stranded the 14:56 point as a track of its own. The speed check objected to neither: 20.4 km in 6.4 hours is under 3 km/h, against the 20.4 km/h the rule allows. With any reasonable motion model, the 15:02 sighting is about 110 to 430 times more probable as a continuation of Scott's own six-minute-old point than of the six-hour-old morning point (section 1). The real question about the morning point is whether a different group could have arrived in six hours. A fixed 20 km cap is a crude stand-in for that question, and it gives the same answer at six minutes and at six hours.

Heuristics the literature justifies, each buildable on the existing species, time and distance checks:

1. **A reach that grows with elapsed time and with each source's error.** Replace the fixed 20 km cap and 3 km allowance with a gate computed from both sightings' position uncertainties plus a term that grows with time. Every animal-movement state-space model in section 2.7 works this way. Per-source defaults are in the table at the end.
2. **Score candidate tracks by likelihood, with "new group" as a candidate.** "Nearest point" ignores time. "Nearest in space and time" treats elapsed time as distance the whales certainly travelled. A probability model treats elapsed time as a widening circle around the last position, which lets a lingering group of Bigg's keep its track while still preferring a twelve-minute-old point to an hour-old one. Multiple hypothesis tracking supplies the "new group" candidate.
3. **Solve the day as a whole.** A min-cost network flow finds the best set of tracks for a day exactly and cheaply. It assumes each sighting belongs to one track, so merges need separate handling.
4. **Ecotype is a cannot-link; pod and matriline are evidence.** Residents and Bigg's "do not mix" (Ford et al. 1998). Resident pods and matrilines vary in cohesion and can split for good, so a named group should adjust a score and never forbid a join on its own.
5. **Close editors' must-links transitively and surface contradictions.** A cannot-link inside a chain of must-links is a contradiction that a union-find pass finds in linear time. Because a day has no upper limit on tracks, any consistent set of claims can be honoured. Contradictions go to a curator, as [decision 062](../decisions/062-segment-edits-are-claims-about-sightings.md) and [decision 014](../decisions/014-trust-and-curation-model.md) provide.
6. **Record where the animals were, separately from where the observer stood.** GPS fixes and iNaturalist accuracy circles describe the observer. The cheapest large gain in evidence is a bearing and a rough range, or an angle below the horizon. Hydrophone detections should carry a radius of several kilometres and their time span.

The literature warns against three things: blending two candidate tracks into an averaged position, methods that keep counts of animals without identities, and freezing a decision once made, as the current rule does.

## 1. The worked example, through the theory

Assume for illustration that each reported position is uncertain by about 1 km in each direction, and that orcas move about 6.8 km in an hour, the figure the rule already uses. These are not fitted values. Under a **random-walk model** (heading unknown, spread growing with the square root of elapsed time) and under a **straight-travel model** (heading kept, spread growing in proportion to elapsed time), the 15:02 sighting compares like this:

| | Morning track's 08:33 point | Scott's 14:56 point |
|---|---|---|
| Distance to the 15:02 sighting | 19.8 km | 1 km |
| Time since | 6 h 29 min | 6 min |
| Relative probability, random walk | 1 | about 114 |
| Relative probability, straight travel | 1 | about 430 |

Either way the 15:02 sighting belongs with Scott's encounter. The current rule never asks, because it finished the morning track first. Both variants tested in #445 consider all open tracks at once and get this right.

The 14:56 point is a different question. Under the random-walk model, a gate that keeps 99% of true continuations has a radius of about 37 km after 6.4 hours, so 20.4 km is within reach. Whether the point should join depends on the alternative: how likely is it that another group of orcas turned up in that area during the afternoon? That is the "new target" term in multiple hypothesis tracking (section 2.2). The morning record also includes a 07:15 Orcasound Lab detection of Bigg's calls. Hydrophones hear calls over several kilometres (section 3.5), which further loosens what the morning reports say about where those animals were.

## 2. Theory for joining sightings into segments

### 2.1 Open-universe models and identity uncertainty

**What it is.** An **open-universe** model lets the number of objects be unknown and treats "which object produced this observation?" as something to infer. Milch et al. (2005) introduced BLOG, a language for such models, naming multi-target tracking ("connecting, say, radar blips to hypothesized aircraft") and record linkage as motivating cases. Pasula et al. (2003) named the core difficulty **identity uncertainty**, which "arises whenever objects are not labeled with unique identifiers or when those identifiers may not be perceived perfectly". Pasula, Russell, Ostland and Ritov (1999) applied it to cars seen by a chain of unreliable freeway sensors: estimating each car's intrinsic properties is what lets distant sightings be linked.

**For us.** A segment is an identity claim about animals unseen between sightings. The number of groups out on a day is unknown, a sighting may come from a group not yet seen, and reported attributes (ecotype, pod, count) are the intrinsic properties that link sightings when geometry cannot. **Justifies:** always scoring "new group"; using reported attributes as weighted evidence. **Warns against:** any rule whose answer depends on processing order.

### 2.2 Multi-target data association

**Data association** decides which observation came from which target.

**Multiple hypothesis tracking (MHT).** Reid (1979) computes, for each report, the probability "that the measurement came from a target already known, or from a new target, or that the measurement is false", and keeps several joint explanations alive so later reports can revise earlier ones ("multiple-scan correlation"). "Unlikely hypotheses are eliminated and hypotheses with similar target estimates are combined", and the problem is split into independent clusters of nearby targets. **For us:** this is the clearest statement of what our rule lacks: the new-group alternative, room for a mis-located report, and the ability of the 15:02 sighting to fix the 14:56 one. Clustering keeps it cheap, since a sighting off Victoria never competes with one in Puget Sound.

**Joint probabilistic data association (JPDA).** Fortmann, Bar-Shalom and Scheffe (1983), working on passive sonar, compute the probability that each report came from each nearby target and update every target with a probability-weighted blend. Bar-Shalom and Fortmann (1988) also describe **validation gates**: a region around each target's predicted position outside which a report is ignored. **Justifies:** gates sized by uncertainty, where our 20 km cap is a gate of fixed size. **Warns against:** blending. Near each other, blended estimates get pulled together, a failure named **track coalescence** (Blom and Bloem 2000). K pod and the Bigg's group 5 km apart in Admiralty Inlet, in #445, is exactly that setting.

**Random finite sets and the PHD filter.** Mahler (2003) treats all targets as one random set and propagates the **probability hypothesis density (PHD)**, whose integral over an area is the expected number of targets there. **Warns against** it for segments: it does not keep identities, so it cannot draw a line between two sightings.

**Labelled random finite sets.** Vo and Vo (2013) gave each target a permanent label inside that framework, yielding the generalised labelled multi-Bernoulli (GLMB) filter. Reuter et al. (2014) gave a cheaper approximation, the labelled multi-Bernoulli (LMB) filter, which "outputs target tracks". **For us:** this is what a full tracker would be built on, and far more than a day of 20 to 200 sightings needs.

**Batch association by network flow.** Zhang, Li and Nevatia (2008) map the most probable assignment of observations to tracks onto a network whose edges carry costs for linking two observations, starting or ending a track, and declaring an observation false. "The optimal data association is found by a min-cost flow algorithm", with "a non-overlap constraint on trajectories", and it "does not require hypotheses pruning". **For us:** a good fit for a finished day. Link costs come from the gate model in 2.7, and start and end costs encode "new group". A cannot-link between sightings that would be adjacent is a deleted edge. **Caveats:** a sighting can belong to only one track, which fails at merges (2.3), and a cannot-link between non-adjacent sightings constrains a whole path, which flow cannot express, so it must be checked afterwards.

### 2.3 Groups that split and merge

**What it is.** A tracking **group** is several targets moving together; an **extended target** is one object producing several reports. Mihaylova et al. (2014) review both. Methods that also infer group structure, including splits and merges, are recent; Zhang et al. (2022, preprint) jointly infer "group structure, data association and target states" and capture "group splitting and merging".

**For us.** A sighting is usually of a group, often of part of one, and the report rarely says which. **Justifies:** letting two tracks converge on one sighting and leave as one, and the reverse at a split, when a claim or a reported identity supports it. **Warns against:** inferring merges and splits from position alone, which cannot tell a merge from two groups passing.

### 2.4 Fission–fusion dynamics and killer whales

**What it is.** Aureli et al. (2008) define fission–fusion dynamics as "the extent of variation in spatial cohesion and individual membership in a group over time", measured on three axes: how spread out a group is, how large its parties are, and who is in them. Societies range from "highly cohesive with stable group membership" to highly fluid. For killer whales here:

- Residents and Bigg's (transients) "do not mix, and differ in seasonal distribution, social structure, and behaviour" (Ford et al. 1998).
- Bigg's pods are small and stable, averaging 2.4 animals, but some males become "roving" males "spending some of their time alone, and occasionally associating with groups" (Baird and Whitehead 2000). Some Bigg's pods "spent much of their time foraging around pinniped haulouts and other nearshore sites" (Baird and Dill 1995).
- Southern Resident matrilines and pods associate preferentially, but cohesion varied across years and was lower in years of low salmon abundance (Parsons et al. 2009).
- Matrilines can split permanently, "both along and across maternal lines" (Stredulinsky et al. 2021).

**For us.** Ecotype is the one reported identity strong enough to forbid a join. A registered matriline says who belongs together over years and little about who was in a party at 14:56. **Justifies:** a cannot-link between sightings reported as different ecotypes, unless a curator-validated must-link overrides it (how much an unvalidated claim counts is left open by [decision 062](../decisions/062-segment-edits-are-claims-about-sightings.md)); a score bonus for sightings naming the same pod or matriline and a smaller penalty for different ones; slower motion parameters for Bigg's than for residents (2.7).

### 2.5 Must-link and cannot-link

**What it is.** Wagstaff, Cardie, Rogers and Schrödl (2001) added pairwise constraints to clustering: must-link ("two instances have to be in the same cluster") and cannot-link ("must not be placed in the same cluster"). Must-links are transitive, and they close over both kinds "because, e.g., if d_i must link to d_j which cannot link to d_k, then we also know that d_i cannot link to d_k". Their greedy algorithm is "order-sensitive. If a poor decision is made early on, the algorithm may later encounter an instance that has no possible valid cluster", and "ideally, the algorithm would be able to backtrack". Davidson and Ravi (2005) showed that satisfying cannot-links is NP-complete when the number of clusters is capped, by reduction from graph colouring. Davidson and Basu's survey adds that with enough clusters "there will always be a feasible clustering".

**For us.** Decision 062 adopted these terms. Ours is the easy case: tracks per day are uncapped, so claims without an internal contradiction can always be honoured. Wagstaff's warning about greedy, order-sensitive assignment describes our current rule. **Justifies:** close validated must-links with union-find; flag any cannot-link whose two sightings land in one must-link group as a contradiction for a curator; then run the rule with each must-link group as one unit and each cannot-link as a forbidden join. That answers one of 062's open questions for validated claims, while candidate claims can enter as score adjustments.

### 2.6 Entity resolution, and revising decisions afterwards

**What it is.** **Entity resolution** decides which records describe the same real thing. Fellegi and Sunter (1969) framed it as a three-way decision over pairs: link, non-link, or leave for review. In Winkler's (1993) summary, their rule minimises "the set of pairs on which no decision is made" for fixed rates of false matches and false non-matches. **Correlation clustering** (Bansal, Blum and Chawla 2004) partitions items given pairwise "same" and "different" labels, minimising disagreements, which suits labels that are soft and sometimes conflict. Steorts, Hall and Fienberg (2016) link records "directly to latent true individuals, and only indirectly" to each other. A **filter** estimates the present from the past; a **smoother** re-estimates the past using later observations too (Särkkä 2013).

**For us.** Our rule is a filter that forgets its alternatives, yet every segment is drawn after the fact, so we can afford a smoother. The three-way decision is a design pattern for the map: confident joins drawn, ruled-out joins not drawn, and a middle band shown as "possibly the same group", which is where an editor's claim is worth most. **Justifies:** drawing uncertain joins differently (dashed, say); a sighting card that explains its join or its absence; recomputing the day when a late sighting arrives.

### 2.7 Movement models with a different error for each fix

**What it is.** A **state-space model** pairs a model of how the animal moves with a model of how each reported position (each **fix**) departs from the truth, and estimates the path that best explains both.

- **Argos classes.** The Argos manual gives classes 3, 2, 1 and 0 errors of under 250 m, 250 to 500 m, 500 m to 1.5 km and over 1.5 km (one standard deviation), with A and B unbounded. Measured against GPS on pinnipeds, the 68th-percentile errors were 0.49, 1.01, 1.20, 4.18, 6.19 and 10.28 km for classes 3 to B, all "highly right-skewed" (Costa et al. 2010). Vincent et al. (2002) found longitude errors larger than latitude errors.
- **Correlated random walk.** Johnson, London, Lea and Durban (2008) model velocity as drifting back toward a mean, so an animal keeps its heading over short times and wanders over long ones, with fixes at any time. The R package `crawl` implements it.
- **Jonsen's models.** Jonsen, Mills Flemming and Myers (2005) used heavy-tailed errors so wild fixes do not drag the path. Jonsen (2016) fitted several animals jointly (R package `bsam`, now archived). Jonsen et al. (2020) built a fast continuous-time model released as `foieGras`, later renamed `aniMotum` (Jonsen et al. 2023). `aniMotum` takes a per-fix error class, error ellipse, or longitude and latitude error, and offers a **move persistence** model that estimates along the track how strongly each step continues the last. Its documentation warns that the correlated random walk "tends to estimate nonsensical (i.e., 'looping' artefacts) movement through longer data gaps, especially when animals are mostly stationary during those gaps".

**For us.** Our evidence resembles an Argos dataset, with the error grade set by kind of report. The `aniMotum` warning describes the "nearest in space and time" failure: a model that assumes the whales keep moving misreads a group that stayed put, as the hunting Bigg's in Baird and Dill (1995) do. Move persistence is the principled fix. **Justifies:**

- A default position uncertainty per source, overridden by a sighting's own value where recorded.
- A gate of radius k·√(σ₁² + σ₂² + q·Δt), with σ₁ and σ₂ the two sightings' uncertainties, Δt the elapsed time, q set from travel speed, and k about 3 for 99%.
- A score from the same model, so elapsed time widens the circle and leaves its centre where it was.
- A smaller q for Bigg's, or a score taking the better of a "travelling" and a "lingering" model, as a cheap stand-in for move persistence.
- Heavy tails, so an occasional badly placed report costs something without being impossible.

**Warns against** interpolating smooth paths through gaps; `aniMotum` ships a helper to reroute estimated tracks around land, because they otherwise cross it.

## 3. Better position evidence

### 3.1 Where the error comes from

A sighting's position has two parts: where the observer was, which phone GPS now gives to a few metres, and the offset to the animals, a bearing and a range, which is usually far larger. [Decision 029](../decisions/029-map-symbology.md) already records that "`accuracy` describes where the reporter was". This note's brief adds that 74% of track-eligible sightings, the Orca Network reports via Maplify, carry no uncertainty, and that iNaturalist accuracy on those sightings has a median of 547 m. Decision 029 measured 31 m across all iNaturalist records, so whale sightings are much less precise than iNaturalist in general.

### 3.2 Shore-based theodolite tracking

**What it is.** A **theodolite** measures horizontal and vertical angles precisely. From a station of known height, the angle down to the animal gives its range (Lerczak and Hobbs 1998), and the bearing completes the position. "Distance measurement accuracy is a direct function of elevation measurement accuracy" (Frankel, Yin and Hoffhines 2009).

**Typical error.** From a cliff about 50 m above Johnstone Strait, Williams, Trites and Bain (2002) checked their apparatus on a 30 m rope 3.79 km away and found "a measurement error of c. 3.5% in terms of accuracy, and < 1% in terms of precision", about 130 m at that range. They corrected station height for the tide every 15 minutes and preferred mid-strait whales "since accuracy of a reading diminishes with distance from the theodolite". Against drone positions within about 300 m of a 20 m cliff, theodolite fixes were off by a mean of 8.3 to 26.6 m depending on fix quality (Dinkel et al. 2025). Out to 25 km, Sagnol et al. (2014) found accuracy "fell rapidly with an increase in range", with the vertical angle as the weak measurement. Theodolite studies of Southern Residents from the west side of San Juan Island exist (Williams et al. 2009; Lusseau et al. 2009; Noren et al. 2009), but I could not reach their methods.

**For us.** A theodolite fix is the reference for calibrating defaults for shore reports. **Justifies:** the tightest default after GPS on the animal itself, if such data ever flows in.

### 3.3 Reticle binoculars and naked-eye range

**What it is.** A **reticle** is a scale in a binocular eyepiece. Counting marks from the horizon to the animal measures the angle below the horizon, which with eye height gives range (Lerczak and Hobbs 1998).

**Typical error.** Kinzey and Gerrodette (2003) measured 1,576 targets 0.3 to 10.4 km away from 10.5 m platforms against radar. Reticles were unbiased to about a third of the way to the horizon and underestimated beyond it, mainly through refraction. "Including errors due to bias, the multiplicative standard error was 12%, or a 95% confidence interval from 0.8–1.2 km for a target at 1 km and from 6.5–9.9 km for a target at 8 km." Leaper et al. (2010) found a coefficient of variation of 0.19 to 0.33 for reticles and 0.39 for naked-eye estimates, with "a consistent, non-linear pattern ... of over-estimating close distances ... and under-estimating those further away". Those observers were trained survey crews.

**For us.** Most Orca Network reports are naked-eye estimates or a place name. **Justifies:** a default uncertainty of about 40% of a typical viewing range, so 1 to 2 km for animals 3 to 5 km offshore. That figure is this note's inference from Leaper et al. A sighter who counts reticle marks, or knows their height above the water, cuts range error roughly threefold.

### 3.4 Photographs: bearing, range and resection

- **Range from the angle below the horizon.** With camera height, focal length and sensor size, the pixels between horizon and waterline give the angle and so the range. Leaper and Gordon (2001) found errors growing "approximately linearly with distance" and an RMS error of 3.5% from an 18 m eye height, biased low unless refraction is corrected.
- **Bearing from the compass.** Exif 2.32 (CIPA DC-X008) defines `GPSImgDirection` as "the direction of the image when it was captured", with `GPSImgDirectionRef` for true or magnetic north, plus `GPSHPositioningError` in metres and `GPSDest…` tags for a "destination point" that could hold the animals' position. Phone compasses are the weak link: on one Android phone, Novakova and Pavlis (2017) found "discrepancies as high as 80° with azimuthal errors dominant". Leaper and Gordon report bearings "within ±3°" from small craft with careful methods. A 10° error moves a whale 2 km away sideways by about 350 m.
- **Resection from landmarks.** Known landmarks in the frame fix the camera's bearing without a compass. Using reference features at known coordinates from a camera 9.59 m above sea level, Hoekendijk et al. (2015) located targets with a mean error of 12.0 m at 0.5 to 1.4 km; camera height was the main error source.

**For us.** **Justifies:** computing range when a photo shows the horizon and the uploader gives a height, and bearing when it shows landmarks. **Warns against:** deriving a position from `GPSImgDirection` alone; use it only to say which side of the observer the animals were on.

### 3.5 Hydrophone detections

Miller (2006) estimated the **active space** of resident calls, the range at which other whales could hear them, at "10–16 km in sea state zero" for long-range calls and 5 to 9 km for others. Hydrophone detection ranges are shorter. Mouy, Austin, Wladichuk and Yurk (2025) modelled Southern Resident pulsed calls at eight stations around the southern Salish Sea: median detection ranges ran "from 650 m under the worst conditions ... to 7.9 km under the best conditions", longer in summer. Bigg's are harder to hear: "transients call less often than residents" (Myers et al. 2025; see also Deecke, Ford and Slater 2005).

**For us.** An Orcasound bout places the animals within several kilometres of the hydrophone over a span of time. **Justifies:** a default radius of about 5 km, narrower in winter, when detection ranges are shorter and a detected group must have been closer to the hydrophone; letting a bout match a track at any time in its span; treating silence as weak evidence about Bigg's.

### 3.6 GPS and iNaturalist pins

Phone GPS is good: a 4.9 m mean under open sky across more than a thousand phones (van Diggelen and Enge 2015), 7 to 13 m for an iPhone 6 in a city (Merry and Bettinger 2019). That accuracy belongs to the phone. iNaturalist's help text for its accuracy field says: "Try to make the circle big enough that you are sure you were somewhere inside it." Its source code notes that the field "is really more like positional uncertainty". An uploader may have moved the pin to the whales, and nothing records whether they did. **Justifies:** adding a range term to iNaturalist accuracy; treating a pin on land as one not moved.

### 3.7 What to ask sighters for

In order of gain for effort: (1) a compass direction from the observer, even "NW", and a range class such as under 500 m, 0.5 to 2 km, or over 2 km; (2) the observer's height above the water, once per regular viewing spot, which with a horizon in the photo gives range to a few percent; (3) reticle readings from those who use reticles; (4) landmarks in the frame; (5) a pin left where the observer stood, with bearing and range given separately.

## Unverified

These came up and could not be confirmed from a primary source. No recommendation rests on them alone.

- An erratum to Lerczak and Hobbs (1998) in *Marine Mammal Science* 14(4):903, seen only in a secondary summary. Crossref gives the article's pages as 590–598; one secondary source gives 590–599.
- Phone compass accuracy figures attributed to Allmendinger, Siron and Scott (2017, *Journal of Structural Geology* 102:98–112): secondary summaries give either about 3.4° or "<10–23°" azimuth error and say iOS did better than Android. Abstract not reached.
- Station heights and accuracy in the San Juan Island theodolite studies (Williams et al. 2009; Lusseau et al. 2009; Noren et al. 2009). The publisher blocked automated access; that they used shore theodolites on the island's west side comes from secondary summaries.
- Sagnol et al. (2014) numerical results; only the abstract's qualitative statement was reached.
- Harzen (2002), cited by Dinkel et al. (2025), for theoretical theodolite errors of 0.2 to 2.7 m at 100 to 1,000 m from a 56 m station. Not read.
- The salmon link in Parsons et al. (2009) and the foraging description in Baird and Dill (1995), both seen only in secondary summaries of the abstracts.
- The Fellegi–Sunter decision rule in the 1969 original, read only through Winkler (1993).
- That track coalescence is a general property of JPDA, inferred from Blom and Bloem's title and abstract summary.
- The published basis for the 6.8 km/h orca travel speed in `src/constants.ts`. Peter reports that the figure came from Dave Bain, probably with some margin added; no publication was traced. Williams and Noren (2009) measured a mean of 1.6 m/s (5.8 km/h) for travelling and foraging northern residents in Johnstone Strait. The rule uses the figure both as a typical speed and, tripled, as a maximum, and those are different quantities.
- How often iNaturalist uploaders move the pin to the animals. No data found.
- The proposed defaults for Orca Network reports (1 to 2 km) and hydrophone detections (about 5 km) are this note's own inferences. I found no published values for these sources.

Corrections to names in the brief: the original JPDA paper is Fortmann, Bar-Shalom and Scheffe (1983), and Bar-Shalom and Fortmann is the 1988 textbook. The GLMB filter is Vo and Vo (2013); the LMB filter is Reuter, Vo, Vo and Dietmayer (2014). `bsam` accompanies Jonsen (2016), a single-author paper, and `foieGras` was renamed `aniMotum`. The best-documented theodolite accuracy figure for killer whales comes from Johnstone Strait, where the animals were northern residents.

## References

Each entry ends with how far it was read for this note.

- Aureli F, Schaffner CM, Boesch C, et al. (2008). Fission-fusion dynamics: new research frameworks. *Current Anthropology* 49(4):627–654. [doi:10.1086/586708](https://doi.org/10.1086/586708) · *read: full text or relevant section*
- Baird RW, Dill LM (1995). Occurrence and behaviour of transient killer whales: seasonal and pod-specific variability, foraging behaviour, and prey handling. *Canadian Journal of Zoology* 73:1300–1311. [doi:10.1139/z95-154](https://doi.org/10.1139/z95-154) · *read: abstract via a search index or secondary summary*
- Baird RW, Dill LM (1996). Ecological and social determinants of group size in transient killer whales. *Behavioral Ecology* 7(4):408–416. [doi:10.1093/beheco/7.4.408](https://doi.org/10.1093/beheco/7.4.408) · *read: abstract via a search index or secondary summary*
- Baird RW, Whitehead H (2000). Social organization of mammal-eating killer whales: group stability and dispersal patterns. *Canadian Journal of Zoology* 78:2096–2105. [doi:10.1139/z00-155](https://doi.org/10.1139/z00-155) · *read: full text or relevant section*
- Bansal N, Blum A, Chawla S (2004). Correlation clustering. *Machine Learning* 56:89–113. [doi:10.1023/B:MACH.0000033116.57574.95](https://doi.org/10.1023/B:MACH.0000033116.57574.95) · *read: bibliographic details only*
- Bar-Shalom Y, Fortmann TE (1988). *Tracking and Data Association.* Academic Press, Mathematics in Science and Engineering vol. 179. · *read: bibliographic details only*
- Blom HAP, Bloem EA (2000). Probabilistic data association avoiding track coalescence. *IEEE Transactions on Automatic Control* 45(2):247–259. · *read: abstract via a search index or secondary summary*
- CLS. Argos user's manual, [location classes](https://www.argos-system.org/manual/3-location/34_location_classes.htm). · *read: full text or relevant section*
- CIPA (2019). *Exchangeable image file format for digital still cameras: Exif Version 2.32*, CIPA DC-X008-2019. [PDF](https://www.cipa.jp/std/documents/e/DC-X008-Translation-2019-E.pdf) · *read: full text or relevant section*
- Costa DP, Robinson PW, Arnould JPY, et al. (2010). Accuracy of ARGOS locations of pinnipeds at-sea estimated using Fastloc GPS. *PLoS ONE* 5(1):e8677. [doi:10.1371/journal.pone.0008677](https://doi.org/10.1371/journal.pone.0008677) · *read: abstract*
- Davidson I, Basu S. A survey of clustering with instance level constraints. Manuscript, [UC Davis](https://web.cs.ucdavis.edu/~davidson/constrained-clustering/CAREER/Survey.pdf). · *read: full text or relevant section*
- Davidson I, Ravi SS (2005). Clustering with constraints: feasibility issues and the k-means algorithm. *Proc. SIAM International Conference on Data Mining*, 138–149. [doi:10.1137/1.9781611972757.13](https://doi.org/10.1137/1.9781611972757.13) · *read: bibliographic details only*
- Deecke VB, Ford JKB, Slater PJB (2005). The vocal behaviour of mammal-eating killer whales: communicating with costly calls. *Animal Behaviour* 69(2):395–405. [doi:10.1016/j.anbehav.2004.04.014](https://doi.org/10.1016/j.anbehav.2004.04.014) · *read: bibliographic details only*
- Dinkel TM, Girard A, Bär T, et al. (2025). Performance of theodolites versus drones in land-based studies of marine mammals. *Scientific Reports* 15:20302. [PMC12198396](https://pmc.ncbi.nlm.nih.gov/articles/PMC12198396/) · *read: abstract*
- Fellegi IP, Sunter AB (1969). A theory for record linkage. *Journal of the American Statistical Association* 64(328):1183–1210. · *read: bibliographic details only*
- Ford JKB, Ellis GM, Barrett-Lennard LG, Morton AB, Palm RS, Balcomb KC (1998). Dietary specialization in two sympatric populations of killer whales (*Orcinus orca*) in coastal British Columbia and adjacent waters. *Canadian Journal of Zoology* 76:1456–1471. [doi:10.1139/z98-089](https://doi.org/10.1139/z98-089) · *read: abstract via a search index or secondary summary*
- Fortmann TE, Bar-Shalom Y, Scheffe M (1983). Sonar tracking of multiple targets using joint probabilistic data association. *IEEE Journal of Oceanic Engineering* 8(3):173–184. · *read: abstract via a search index or secondary summary*
- Frankel AS, Yin S, Hoffhines MA (2009). Alternative methods for determining the altitude of theodolite observation stations. *Marine Mammal Science* 25(1):214–220. [doi:10.1111/j.1748-7692.2008.00240.x](https://doi.org/10.1111/j.1748-7692.2008.00240.x) · *read: full text or relevant section*
- Granström K, Baum M, Reuter S (2017). Extended object tracking: introduction, overview, and applications. *Journal of Advances in Information Fusion* 12(2):139–174. · *read: bibliographic details only*
- Hoekendijk JPA, de Vries J, van der Bolt K, et al. (2015). Estimating the spatial position of marine mammals based on digital camera recordings. *Ecology and Evolution* 5(3):578–589. [doi:10.1002/ece3.1353](https://doi.org/10.1002/ece3.1353) · *read: abstract*
- iNaturalist. Locale strings `accuracy_of_the_coordinates` and `acc`, [config/locales/en.yml](https://github.com/inaturalist/inaturalist/blob/main/config/locales/en.yml). · *read: full text or relevant section*
- Johnson DS, London JM, Lea M-A, Durban JW (2008). Continuous-time correlated random walk model for animal telemetry data. *Ecology* 89(5):1208–1215. [doi:10.1890/07-1032.1](https://doi.org/10.1890/07-1032.1). R package [`crawl`](https://cran.r-project.org/package=crawl). · *read: abstract*
- Jonsen ID (2016). Joint estimation over multiple individuals improves behavioural state inference from animal movement data. *Scientific Reports* 6:20625. [doi:10.1038/srep20625](https://doi.org/10.1038/srep20625) · *read: bibliographic details only*
- Jonsen ID, Mills Flemming J, Myers RA (2005). Robust state-space modeling of animal movement data. *Ecology* 86(11):2874–2880. [doi:10.1890/04-1852](https://doi.org/10.1890/04-1852) · *read: bibliographic details only*
- Jonsen ID, Patterson TA, Costa DP, et al. (2020). A continuous-time state-space model for rapid quality control of Argos locations from animal-borne tags. *Movement Ecology* 8:31. [doi:10.1186/s40462-020-00217-7](https://doi.org/10.1186/s40462-020-00217-7) · *read: abstract*
- Jonsen ID, Grecian WJ, Phillips L, et al. (2023). aniMotum, an R package for animal movement data: rapid quality control, behavioural estimation and simulation. *Methods in Ecology and Evolution* 14(3):806–816. [doi:10.1111/2041-210X.14060](https://doi.org/10.1111/2041-210X.14060). [Documentation](https://ianjonsen.github.io/aniMotum/articles/Overview.html). · *read: full text or relevant section*
- Kinzey D, Gerrodette T (2003). Distance measurements using binoculars from ships at sea: accuracy, precision and effects of refraction. *Journal of Cetacean Research and Management* 5(2):159–171. · *read: full text or relevant section*
- Leaper R, Gordon J (2001). Application of photogrammetric methods for locating and tracking cetacean movements at sea. *Journal of Cetacean Research and Management* 3(2):131–141. [PDF](https://journal.iwc.int/index.php/jcrm/article/download/885/605) · *read: full text or relevant section*
- Leaper R, Burt L, Gillespie D, Macleod K (2010). Comparisons of measured and estimated distances and angles from sightings surveys. *Journal of Cetacean Research and Management* 11(3):229–237. [doi:10.47536/jcrm.v11i3.602](https://doi.org/10.47536/jcrm.v11i3.602) · *read: abstract*
- Lerczak JA, Hobbs RC (1998). Calculating sighting distances from angular readings during shipboard, aerial, and shore-based marine mammal surveys. *Marine Mammal Science* 14(3):590–598. [doi:10.1111/j.1748-7692.1998.tb00745.x](https://doi.org/10.1111/j.1748-7692.1998.tb00745.x) · *read: bibliographic details only*
- Lusseau D, Bain DE, Williams R, Smith JC (2009). Vessel traffic disrupts the foraging behavior of southern resident killer whales *Orcinus orca*. *Endangered Species Research* 6:211–221. [doi:10.3354/esr00154](https://doi.org/10.3354/esr00154) · *read: bibliographic details only*
- Mahler RPS (2003). Multitarget Bayes filtering via first-order multitarget moments. *IEEE Transactions on Aerospace and Electronic Systems* 39(4):1152–1178. [doi:10.1109/TAES.2003.1261119](https://doi.org/10.1109/TAES.2003.1261119) · *read: abstract via a search index or secondary summary*
- Merry K, Bettinger P (2019). Smartphone GPS accuracy study in an urban environment. *PLoS ONE* 14(7):e0219890. [doi:10.1371/journal.pone.0219890](https://doi.org/10.1371/journal.pone.0219890) · *read: abstract via a search index or secondary summary*
- Mihaylova L, Carmi AY, Septier F, Gning A, Pang SK, Godsill S (2014). Overview of Bayesian sequential Monte Carlo methods for group and extended object tracking. *Digital Signal Processing* 25:1–16. [doi:10.1016/j.dsp.2013.11.006](https://doi.org/10.1016/j.dsp.2013.11.006) · *read: abstract*
- Milch B, Marthi B, Russell S, Sontag D, Ong DL, Kolobov A (2005). BLOG: probabilistic models with unknown objects. *Proc. IJCAI-05*, 1352–1359. [PDF](https://people.eecs.berkeley.edu/~russell/papers/ijcai05-blog.pdf) · *read: full text or relevant section*
- Miller PJO (2006). Diversity in sound pressure levels and estimated active space of resident killer whale vocalizations. *Journal of Comparative Physiology A* 192(5):449–459. [doi:10.1007/s00359-005-0085-2](https://doi.org/10.1007/s00359-005-0085-2) · *read: abstract*
- Mouy X, Austin M, Wladichuk J, Yurk H (2025). Modeling the detection range of pulsed calls from resident killer whale in nearshore waters of British Columbia, Canada. *PLoS ONE* 20(9):e0331942. [doi:10.1371/journal.pone.0331942](https://doi.org/10.1371/journal.pone.0331942) · *read: abstract*
- Myers HJ, Olsen DW, Konar BH, et al. (2025). Killer whale call detection rates vary among subspecies and populations in the North Pacific. *Scientific Reports* 15:21072. [doi:10.1038/s41598-025-06041-6](https://doi.org/10.1038/s41598-025-06041-6) · *read: abstract*
- Noren DP, Johnson AH, Rehder D, Larson A (2009). Close approaches by vessels elicit surface active behaviors by southern resident killer whales. *Endangered Species Research* 8:179–192. [doi:10.3354/esr00205](https://doi.org/10.3354/esr00205) · *read: bibliographic details only*
- Novakova L, Pavlis TL (2017). Assessment of the precision of smart phones and tablets for measurement of planar orientations: a case study. *Journal of Structural Geology* 97:93–103. [doi:10.1016/j.jsg.2017.02.015](https://doi.org/10.1016/j.jsg.2017.02.015) · *read: full text or relevant section*
- Parsons KM, Balcomb KC, Ford JKB, Durban JW (2009). The social dynamics of southern resident killer whales and conservation implications for this endangered population. *Animal Behaviour* 77(4):963–971. [doi:10.1016/j.anbehav.2009.01.018](https://doi.org/10.1016/j.anbehav.2009.01.018) · *read: abstract via a search index or secondary summary*
- Pasula H, Russell S, Ostland M, Ritov Y (1999). Tracking many objects with many sensors. *Proc. IJCAI-99*, 1160–1171. [Abstract](https://people.csail.mit.edu/pasula/papers/ijcai99.html) · *read: abstract*
- Pasula H, Marthi B, Milch B, Russell S, Shpitser I (2003). Identity uncertainty and citation matching. *Advances in Neural Information Processing Systems 15* (NIPS 2002), 1401–1408. · *read: abstract*
- Reid DB (1979). An algorithm for tracking multiple targets. *IEEE Transactions on Automatic Control* 24(6):843–854. · *read: full text or relevant section*
- Reuter S, Vo B-T, Vo B-N, Dietmayer K (2014). The labeled multi-Bernoulli filter. *IEEE Transactions on Signal Processing* 62(12):3246–3260. [doi:10.1109/TSP.2014.2323064](https://doi.org/10.1109/TSP.2014.2323064) · *read: abstract via a search index or secondary summary*
- Sagnol O, Reitsma F, Richter C, Field LH (2014). Correcting positional errors in shore-based theodolite measurements of animals at sea. *Journal of Marine Biology* 2014:267917. [doi:10.1155/2014/267917](https://doi.org/10.1155/2014/267917) · *read: abstract via a search index or secondary summary*
- Särkkä S (2013). *Bayesian Filtering and Smoothing.* Cambridge University Press. [Author's PDF](https://users.aalto.fi/~ssarkka/pub/cup_book_online_20131111.pdf) · *read: bibliographic details only*
- Steorts RC, Hall R, Fienberg SE (2016). A Bayesian approach to graphical record linkage and deduplication. *Journal of the American Statistical Association* 111(516):1660–1672. [doi:10.1080/01621459.2015.1105807](https://doi.org/10.1080/01621459.2015.1105807) · *read: abstract*
- Stredulinsky EH, Darimont CT, Barrett-Lennard L, Ellis GM, Ford JKB (2021). Family feud: permanent group splitting in a highly philopatric mammal, the killer whale (*Orcinus orca*). *Behavioral Ecology and Sociobiology* 75:56. [doi:10.1007/s00265-021-02992-8](https://doi.org/10.1007/s00265-021-02992-8) · *read: abstract*
- van Diggelen F, Enge P (2015). The world's first GPS MOOC and worldwide laboratory using smartphones. *Proc. ION GNSS+ 2015*, 361–369. [Abstract](https://www.ion.org/publications/abstract.cfm?articleID=13079) · *read: abstract*
- Vincent C, McConnell BJ, Ridoux V, Fedak MA (2002). Assessment of Argos location accuracy from satellite tags deployed on captive gray seals. *Marine Mammal Science* 18(1):156–166. · *read: abstract via a search index or secondary summary*
- Vo B-T, Vo B-N (2013). Labeled random finite sets and multi-object conjugate priors. *IEEE Transactions on Signal Processing* 61(13):3460–3475. [doi:10.1109/TSP.2013.2259822](https://doi.org/10.1109/TSP.2013.2259822) · *read: bibliographic details only*
- Wagstaff K, Cardie C, Rogers S, Schrödl S (2001). Constrained k-means clustering with background knowledge. *Proc. ICML 2001*, 577–584. · *read: full text or relevant section*
- Williams R, Trites AW, Bain DE (2002). Behavioural responses of killer whales (*Orcinus orca*) to whale-watching boats: opportunistic observations and experimental approaches. *Journal of Zoology* 256(2):255–270. [doi:10.1017/S0952836902000298](https://doi.org/10.1017/S0952836902000298) · *read: full text or relevant section*
- Williams R, Bain DE, Smith JC, Lusseau D (2009). Effects of vessels on behaviour patterns of individual southern resident killer whales *Orcinus orca*. *Endangered Species Research* 6:199–209. [doi:10.3354/esr00150](https://doi.org/10.3354/esr00150) · *read: bibliographic details only*
- Williams R, Noren DP (2009). Swimming speed, respiration rate, and estimated cost of transport in adult killer whales. *Marine Mammal Science* 25(2):327–350. [doi:10.1111/j.1748-7692.2008.00255.x](https://doi.org/10.1111/j.1748-7692.2008.00255.x) · *read: full text or relevant section*
- Winkler WE (1993). Improved decision rules in the Fellegi-Sunter model of record linkage. U.S. Census Bureau Research Report RR93/12. [PDF](https://www.census.gov/content/dam/Census/library/working-papers/1993/adrm/rr93-12.pdf) · *read: full text or relevant section*
- Zhang L, Li Y, Nevatia R (2008). Global data association for multi-object tracking using network flows. *Proc. IEEE CVPR 2008*, 1–8. [doi:10.1109/CVPR.2008.4587584](https://doi.org/10.1109/CVPR.2008.4587584) · *read: full text or relevant section*
- Zhang X, Meng F, Liu H, Shen X, Zhu Y (2022). Seamless tracking of group targets and ungrouped targets using belief propagation. Preprint, [arXiv:2208.12035](https://arxiv.org/abs/2208.12035) · *read: abstract*

## Typical position error by source

| Source type | Typical position error | Source |
|---|---|---|
| Phone or camera GPS, the observer's own position | About 5 m mean under open sky; 7 to 13 m in a city | van Diggelen and Enge 2015; Merry and Bettinger 2019 |
| GPS fix graded by Argos (class `G`) | Under 100 m | Argos manual |
| Argos satellite fixes, classes 3, 2, 1, 0 (nominal, one standard deviation) | Under 250 m; 250 to 500 m; 0.5 to 1.5 km; over 1.5 km | Argos manual |
| Argos fixes measured against GPS, classes 3, 2, 1, 0, A, B (68th percentile) | 0.49, 1.01, 1.20, 4.18, 6.19, 10.28 km | Costa et al. 2010 |
| Shore theodolite, about 50 m station, about 3.8 km range | About 3.5% of range (about 130 m) | Williams, Trites and Bain 2002 |
| Shore theodolite, 20 m station, within about 300 m | 8 to 27 m mean, by fix quality | Dinkel et al. 2025 |
| Fixed camera with surveyed landmarks, 0.5 to 1.4 km | 12 m mean | Hoekendijk et al. 2015 |
| Range from photo or video angle below horizon, 18 m eye height | 3.5% RMS of range | Leaper and Gordon 2001 |
| Reticle binoculars, 10.5 m platform | 12% multiplicative standard error (0.8 to 1.2 km at 1 km) | Kinzey and Gerrodette 2003 |
| Reticle binoculars, several surveys | Coefficient of variation 0.19 to 0.33 | Leaper et al. 2010 |
| Naked-eye range estimate | Coefficient of variation 0.39; near overestimated, far underestimated | Leaper et al. 2010 |
| Bearing from a phone compass (`GPSImgDirection`) | Up to 80° on one Android phone; 10° is about 350 m sideways at 2 km | Novakova and Pavlis 2017 |
| Bearing by careful methods from a small craft | Within ±3° | Leaper and Gordon 2001 |
| Hydrophone detection of Southern Resident calls | Animals within 0.65 to 7.9 km (median detection range, worst to best conditions) | Mouy et al. 2025 |
| Resident call active space (outer bound) | 5 to 16 km in calm seas | Miller 2006 |
| iNaturalist accuracy circle | Describes the observer's position; median 547 m on track-eligible sightings | iNaturalist locale text; this note's brief |
| Orca Network reports via Maplify | Not recorded; inferred default 1 to 2 km | Inference from Leaper et al. 2010 |
