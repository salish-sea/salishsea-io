# Open data for a watershed layer and a sea-area layer

**Research date:** 2026-10-27 · **Author:** research agent (AI-assisted), for Peter Abrahamsen · **Status:** background/reference; informs `salish-7ds1.2` (watershed polygons) and `salish-fwyt.2` (a sighting's place)

Every source below was checked against its owner's own pages or services on this date unless a line says otherwise. Where the agent could not confirm something, the report says so. "Decision 020" here is the basemap's, [each named river that reaches the sea is labelled at its mouth with its salmon runs](https://github.com/salish-sea/basemap/blob/71986bdeecb326de5a56c996917fc2e9feff6332/decisions/020-each-river-mouth-is-labelled-with-its-salmon-runs.md), not this repository's decision 020.

## The short answer

- **Watersheds.** The polygons can come from two government datasets that already speak decision 020's language. In British Columbia, the province's Freshwater Atlas publishes one polygon per named stream's whole watershed, keyed by the same watershed code that NuSEDS gives and that decision 020 uses to define a river: the Cowichan's polygon carries `920-252823-…`, the Harrison's `100-077501-…`. A river is then one lookup. In Washington, the USGS's NHDPlus High Resolution has a catchment polygon for every stream reach, and every reach carries the identifier of the outlet it finally drains to (its "terminal path"). Joining each decision 020 system's outlet to the nearest reach gives that identifier, and the union of all catchments that share it is the system's watershed. Both are open: the USGS's data is in the public domain, and the Freshwater Atlas is under the Open Government Licence – British Columbia, which allows redistribution with credit and is not share-alike.
- **3DHP, the source Peter named, is not ready here.** It is the USGS's replacement for the National Hydrography Dataset, the Watershed Boundary Dataset and NHDPlus HR, and it is live. But its catchments exist only where new elevation-derived streams have been mapped, and on 2026-10-27 none of those areas falls within the coverage box: its catchment layer returns no features anywhere in Washington or Oregon west of 120°W. Its Washington streams are copies of the old National Hydrography Dataset.
- **Sea areas.** No source supplies a ready-made partition of the coverage area. The pieces are good, though. Two findings matter most. First, Canada's official place-name database (CGNDB) now publishes outlines, not only points, for many marine features, and for features shared with the US its outlines cross the border: Haro Strait, Juan de Fuca Strait and the Strait of Georgia each cover both countries' waters. It is under the Open Government Licence – Canada, which already covers the basemap's Canadian names. Second, NOAA's electronic charts carry named sea-area outlines (the S-57 "SEAARE" objects) for the US side, in the public domain, through the same ENC Direct service the basemap already uses for shipping lanes. Neither is a partition: outlines nest (Malaspina Strait sits inside the Strait of Georgia, which sits inside the Salish Sea) and leave gaps. SalishSea.io would still have to build the partition: choose which tier of names counts, let the smallest outline win where they nest, and fill the gaps by hand or by rule.

## What the watershed polygons must line up with

The basemap's [decision 020](https://github.com/salish-sea/basemap/blob/71986bdeecb326de5a56c996917fc2e9feff6332/decisions/020-each-river-mouth-is-labelled-with-its-salmon-runs.md) labels about 84 named river systems that reach the sea, across Washington and the British Columbia shore beside it. It builds them in two different ways.

- **In Washington**, a system is assembled from SWIFD's stream lines: each stream flows into the stream its lower end touches, and the system is labelled where its outlet meets the sea. Systems of one name with mouths within 15 km of each other are merged, as the Skagit's forks are, and a system may carry two names, as "Cedar and Sammamish Rivers" does at the Ballard Locks.
- **In British Columbia**, a river is its provincial watershed code, read from NuSEDS's `FWA_WATERSHED_CDE` field ([`scripts/salmon.py`](https://github.com/salish-sea/basemap/blob/71986bdeecb326de5a56c996917fc2e9feff6332/scripts/salmon.py#L411) in the basemap). A code that is one group for a great river (the Fraser's `100`), a coastal drainage's own river in the 900s, or one level below a coastal drainage (the Cowichan's `920-252823`) is a river that reaches the sea.

So the watershed polygon for a Washington system has to be derived from the system's outlet, and the polygon for a British Columbia river has to be keyed by its code. Rights determination D-24 ([rights policy §7.3](../rights-policy.md#73-which-salmon-run-in-which-river-wdfw-and-nwifcs-swifd-and-dfos-nuseds-d-24)) lets SalishSea.io use SWIFD's and NuSEDS's facts but not reproduce their records or geometry. The polygons must therefore come from a different, openly licensed dataset; SWIFD's lines can be used only to find which polygon belongs to which system.

## Watershed sources

### USGS 3D Hydrography Program (3DHP)

- **What it is.** The USGS's program to remap the country's surface water from the 3D Elevation Program's lidar, which it calls "the first systematic remapping of the Nation's surface waters since the original 1:24,000-scale topographic mapping" ([3DHP home page](https://www.usgs.gov/3d-hydrography-program)). It replaces three older products: the USGS says that "in 2024" it moved from maintaining the National Hydrography Dataset (NHD), the Watershed Boundary Dataset (WBD) and NHDPlus High Resolution to 3DHP, and that those "legacy products are no longer updated and maintained" ([Access 3DHP data products](https://www.usgs.gov/3d-hydrography-program/access-3dhp-data-products)). The NHD itself was retired on 2023-10-01 ([NHD page](https://www.usgs.gov/national-hydrography/national-hydrography-dataset)).
- **What it holds.** The feature service ([`usgs_3dhp_all` FeatureServer](https://3dhp.nationalmap.gov/arcgis/rest/services/usgs_3dhp_all/FeatureServer)) has layers for flowlines, waterbodies, points on the network, catchments, and the outlines of the areas mapped so far ("work units"). Its own description: it "will include catchments, drainage areas, and flow network derivatives as they are populated in the future … Where EDH [elevation-derived hydrography] has not been collected, 3DHP data will be supplemented by data from the National Hydrography Dataset." I found no hydrologic-unit layer in the service, although a ScienceBase record lists hydrologic units among 3DHP's eventual components.
- **Coverage within the box, checked by querying the service.** The catchment layer holds 300,070 catchments nationally, and none in a box over western Washington (124.8–120°W, 45.5–49.1°N), none over western Oregon, and none around the Elwha. Only 10 areas have been mapped from elevation so far; the one in Washington (`WA_USFS_PNW_5_D23`) lies at 119.5–119.0°W, east of the coverage box. The Elwha's flowlines are in the service, 136 of them named "Elwha River", each with `workunitid` = `NHD`, meaning they are the old NHD lines, now carrying network attributes such as `terminalpath` (an identifier shared by every line that drains to one outlet) and a link to a "reference mainstem" identifier. Their `catchmentid3dhp` field is empty.
- **Release schedule.** New elevation-derived data reaches the services quarterly; a downloadable product is published early each federal fiscal year and kept with a DOI ([Access page](https://www.usgs.gov/3d-hydrography-program/access-3dhp-data-products)). The current download is the [2025 Staged Product (FY26 release)](https://www.sciencebase.gov/catalog/item/6930876ed4be027594fed169), published 2026-01-23 as a FileGDB and a GeoPackage for the lower 48 states. I found no date by which western Washington will be mapped; the program's tracker maps were not checked in detail.
- **Licence.** The service states "Use Constraints: None. All data are open and non-proprietary." USGS data is in the public domain ([USGS copyrights and credits](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)). Fits both uses.
- **Fit.** None for now. Watch it: when western Washington is mapped, its catchments will replace NHDPlus HR's, and since its flowlines already carry `terminalpath`, a pipeline built on NHDPlus HR's equivalent field would carry over.
- **Catch.** No catchments in the box; the published download covers the whole lower 48 states in one file (size not stated on the page; not downloaded).

### Watershed Boundary Dataset (hydrologic units, HUC2 to HUC12)

- **What it is.** Nested drainage polygons with codes of 2 to 12 digits (16 in places). The 12-digit units ("HUC12s") are complete nationally ([WBD page](https://www.usgs.gov/national-hydrography/watershed-boundary-dataset)). The USGS calls its last national file "the authoritative snapshot of the dataset while the program shifts focus to the new 3DHP data model"; the reference service at geoconnex.us labels the 2025 units "final". So it is frozen and stable.
- **Coverage.** All of Washington, Oregon and California within the box. Across the border, the USGS says 10- and 12-digit units are complete inside every 8-digit unit that crosses into Canada. I confirmed this: the Upper Skagit unit (`17110005`) has HUC12s in British Columbia, such as "Headwaters Skagit River" and "Upper Sumallo River"; the US units that drain to the Fraser are their own 8-digit unit, `17110001` "Sumas River"; and the "Strait of Georgia" unit `17110002` reaches into British Columbia as far as the Nicomekl. It does not cover the Fraser or any other wholly Canadian basin. **It also partitions marine water**: some HUC12s are open water, such as "Discovery Bay-Strait of Juan De Fuca" (`171100200700`), "Rosario Strait-Strait of Juan De Fuca", "Haro Strait-Strait of Georgia", "Port Orchard Sound", "Skagit Bay", "South Puget Sound" and "Hood Canal". "Port San Juan-Strait of Juan De Fuca" runs north to 48.67°N, so it includes Canadian waters. These are discussed under sea areas.
- **The Elwha as an example.** The 10-digit unit `1711002005` is named "Elwha River" and is made of 14 HUC12s, from "Headwaters Elwha River" (`171100200501`) to "Lake Aldwell-Elwha River" (`171100200514`), totalling 830.7 km². The lowest drains into the marine unit `171100200700`. For a river of the Elwha's size, the 10-digit unit is the watershed.
- **The catch.** Small rivers that reach the sea directly are lumped. Coastal HUC12s are often "frontal" units holding several creeks: "Ennis Creek-Frontal Port Angeles Harbor" (112 km²) holds Ennis Creek and the shore beside it, and "Morse Creek-Frontal Port Angeles Harbor" is a 10-digit unit of several creeks. Any decision 020 system smaller than a HUC12 cannot get its own polygon from WBD.
- **Format and fetch.** Static files on the USGS's S3 bucket: the national file (`StagedProducts/Hydrography/WBD/National/GPKG/WBD_National_GPKG.zip`, 5.7 GB, dated 2026-09-02) or the Pacific Northwest region (`WBD/HU2/GPKG/WBD_17_HU2_GPKG.zip`, 824 MB, dated 2025-01-08), also as FileGDB and shapefile. The live map service at hydro.nationalmap.gov timed out every time I tried it.
- **Licence.** Public domain ([USGS policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)); the file's metadata asks that "acknowledgment of the origination agencies would be appreciated". Fits both uses.

### NHDPlus High Resolution catchments

- **What it is.** The NHD's 1:24,000-scale streams, with a catchment polygon for each reach, drawn from 10 m elevation, plus "value-added attributes" for navigating the network ([user guide, SIR 2025–5031](https://pubs.usgs.gov/publication/sir20255031/full)). The attribute that matters here is `TerminalPa`: "the same value for each of the NHDFlowline features in an entire drainage area … all the features that flow to the mouth of the Delaware River will have the same value." The guide's own example 2 is "Using TerminalPa to select the river and its drainage area".
- **Fit for decision 020's Washington systems.** This is the closest match to how 020 builds systems. A system's outlet point, matched to the nearest coastal reach, gives a `TerminalPa`; dissolving every catchment with that value gives the system's whole watershed, however small the river. Systems that 020 joins share one terminal already in most cases: the Cedar and the Sammamish both drain through Lake Washington to one outlet, and the Black and the Green drain through the Duwamish. Systems that 020 merges by name (the Skagit's forks) may have separate terminals and would be merged the same way 020 merges them. I did not test any of this on the data.
- **Coverage.** Washington, Oregon and California. For basins that cross the border the guide says Canadian streams were added "to improve catchment delineations in locations where NHDFlowline features receive contributing drainage from international areas"; I did not confirm whether catchment polygons themselves extend into British Columbia (for example, over the upper Skagit). If they don't, WBD's Canadian HUC12s fill that part.
- **Format and fetch.** Static files on the same S3 bucket, by four-digit region: Puget Sound (`NHDPlusHR/VPU/Current/GDB/NHDPLUS_H_1711_HU4_GDB.zip`, 482 MB, dated 2024-02-29), the Washington coast (`1710`, 1.4 GB) and others; FileGDB only, which GDAL reads. National Release 2 (31 GB) is also there.
- **Licence.** Public domain. Fits both uses.
- **Catch.** Frozen since 2024 and destined to be replaced by 3DHP; heavy files; catchment edges are drawn from a 10 m grid, so they are fine at the zooms a shaded layer is seen at.

### British Columbia Freshwater Atlas

- **What it is.** The province's 1:20,000 hydrography, with a hierarchical watershed code on every stream and every watershed polygon ([BC Data Catalogue](https://catalogue.data.gov.bc.ca/dataset/freshwater-atlas-named-watersheds); [Freshwater Atlas page](https://www2.gov.bc.ca/gov/content/data/geographic-data-services/topographic-data/freshwater)). Four polygon sets matter, each checked through the province's WFS service:
  - **Named Watersheds** (`WHSE_BASEMAPPING.FWA_NAMED_WATERSHEDS_POLY`), 11,580 polygons: one per named stream, covering its whole watershed, with `GNIS_NAME` and `FWA_WATERSHED_CODE`. Examples: Cowichan River, `920-252823-000000-…`, 1,233 km²; Fraser River, `100-000000-…`, 231,525 km²; Harrison River, `100-077501-…`; Squamish River, `900-105574-…`.
  - **Assessment Watersheds**, 19,479 polygons of 20 to 100 km², built from fundamental watersheds by code.
  - **Fundamental Watersheds** (`FWA_WATERSHEDS_POLY`), 3,243,400 polygons: the smallest units, each carrying the code of the stream it drains to.
  - **Watershed Groups**, 246 large units such as "Skagit River" (`SKGT`).
- **How its codes relate to decision 020.** They are the same codes. NuSEDS's field is literally `FWA_WATERSHED_CDE`, and `salmon.py` trims trailing zero groups from it. So the watershed of a decision 020 river is the Named Watershed whose trimmed code equals the river's, or, equivalently, the union of all fundamental watersheds whose code starts with it. No spatial matching is needed.
- **Coverage.** British Columbia only: points in Washington's Skagit and Chilliwack headwaters return no Freshwater Atlas polygon. So the "Skagit River" named watershed (code `970-106243`, 1,057 km²) is only the Canadian part of the Skagit, and the Fraser's polygon lacks the US parts of the Sumas and Chilliwack.
- **Format and fetch.** A live WFS (openmaps.gov.bc.ca) that serves GeoJSON, and bulk zip files on the province's object store ([FWA delivery page](https://nrs.objectstore.gov.bc.ca/itqlyp/FWA_Public/FWA_Delivery.html)): `FWA_BC.zip` holds named watersheds, assessment watersheds and watershed groups at provincial extent, and `FWA_WATERSHEDS_POLY.zip` the fundamental watersheds. Neither page dates or versions the files; the catalogue record was last modified 2026-10-24. So, as 020 does, fetch once into a dated folder.
- **Licence.** [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61): copy, modify, publish and distribute for any lawful purpose, including commercially, with credit ("Contains information licensed under the Open Government Licence – British Columbia" unless the provider names another statement); no share-alike. Fits both uses.
- **Catch.** Stops at the border. The Fraser's polygon is 231,525 km², reaching the Rockies, which raises a design question (below).

### Canada's National Hydro Network and its successor, the Canadian Hydrospatial Network

- **National Hydro Network.** About 1,338 "work units" covering Canada, derived from the Water Survey of Canada's sub-sub-drainage areas ([open.canada.ca record](https://open.canada.ca/data/en/dataset/a4b190fe-e090-4e6d-881e-b87956c07977)), under the Open Government Licence – Canada. Its units are far too large (the lower Fraser is a handful of them) and are not keyed to the province's codes. No fit.
- **Canadian Hydrospatial Network.** Natural Resources Canada's elevation-derived replacement, Canada's counterpart to 3DHP, with flowlines, catchments and "catchment aggregates" ([open.canada.ca record](https://open.canada.ca/data/en/dataset/ae385105-e48c-4b54-bd0f-dfb7303301cb), Open Government Licence – Canada). Its index service lists 30 released work units, all in drainage area `01` (the Maritimes), and its download folder holds only those. Nothing in British Columbia. No fit for now.

### HydroSHEDS and HydroBASINS

- **Version 1** (HydroBASINS v1c): nested basins from a 15 arc-second (about 450 m) grid, average 130 km² at the finest level ([product page](https://www.hydrosheds.org/products/hydrobasins)). Its licence is not open: the [HydroSHEDS v1 licence agreement](https://data.hydrosheds.org/file/technical-documentation/HydroSHEDS_TechDoc_v1_4.pdf) (appendix A) allows distribution only inside "Derivative Works" to end users under an end-user licence agreement "at least as protective", and "in no event shall Licensee license or distribute the Licensed Materials as a stand-alone product". That doesn't fit open tiles or an open archive, and the resolution is too coarse anyway.
- **Version 2**: 1 arc-second (about 30 m), released for the Americas in July 2026; the product page says "The data are distributed under a CC-BY 4.0 license" ([HydroSHEDS v2](https://www.hydrosheds.org/products/hydrosheds-v2)), while also deferring to a licence agreement I did not find. Its basins layer is a beta. It is the only source that crosses the border seamlessly, but its basins are not keyed to SWIFD's systems or the province's codes, and their outlets would need the same matching work as NHDPlus HR. Worth a look only if the border seams turn out to be painful.

### The border seams, concretely

- **Skagit (a Washington system).** Its watershed crosses into British Columbia. WBD's Upper Skagit HUC12s cover the Canadian part; NHDPlus HR may or may not (unverified).
- **Fraser (a British Columbia river).** The province's polygon lacks the Washington parts of the Sumas and Chilliwack. WBD's `17110001` "Sumas River" unit and the Chilliwack's HUC12s in the North Cascades would have to be added.
- **Columbia (a Washington system, labelled at its bar).** Its watershed (commonly given as about 670,000 km², a figure I did not measure) reaches deep into British Columbia, Idaho and Montana, far outside the coverage box. WBD covers all of it, Canada included (the transboundary units are complete), but that is a question of design, not data.

## Sea-area sources

None of these is a ready-made partition of the coverage area. They are listed roughly from most to least useful.

### Canada's geographical names (CGNDB), with outlines

- **What it provides.** Natural Resources Canada's [geographical names service](https://geogratis.gc.ca/services/geoname/en/geonames) returns, for many features, a polygon outline rather than a point (request a name's `.geojson`). Over 125.5–122.5°W, 48–50.5°N, 306 of 703 bays and 76 of 169 channels and straits have outlines, as does the Salish Sea. **Outlines of shared features cross the border**: Haro Strait spans 123.44–122.96°W, out to Cattle Point; Juan de Fuca Strait reaches 48.11°N and 122.65°W, the whole strait; the Strait of Georgia reaches 122.71°W and 48.66°N, past Bellingham. But the "Salish Sea" outline is Canada's part only, and US-only waters (Admiralty Inlet, Rosario Strait, Puget Sound) have none.
- **Detail.** Outlines nest (Malaspina Strait lies inside the Strait of Georgia, which lies inside the Salish Sea); Boundary Pass and Swanson Channel are still points. Names are official and bilingual where Canada names a feature in both languages ("Détroit de Juan de Fuca"), and the database also holds Indigenous names (ḵalpilin, sḵelh).
- **Format and fetch.** A live service only. The pre-packaged downloads ([open.canada.ca record](https://open.canada.ca/data/en/dataset/e27c6eba-3c5d-4051-9db2-082dc6411c2c)) are 3.4 MB for British Columbia, which suggests points; I did not open them to check. Fetch once, by date, as 020 does.
- **Licence.** [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada), the same as the basemap's Canadian names (decision 006). Fits both uses, with credit.
- **Fit.** The best source for the Canadian side, and the only one found that names cross-border straits with one shape each.

### NOAA electronic charts: named sea areas (S-57 SEAARE)

- **What it provides.** Named outlines (`OBJNAM`), with a category (`CATSEA`: canal, slope and others), at each chart scale, through [ENC Direct](https://encdirect.noaa.gov/) (`Sea_Area_Named_Water_Area` layers in `enc_general`, `enc_coastal` and `enc_harbour`). Over the Salish Sea the coastal scale holds 357 polygons and the harbour scale more than 1,000, including Admiralty Inlet, Puget Sound, Rosario Strait, Haro Strait, San Juan Channel, Elliott Bay and Hood Canal, and some Canadian waters near the border (Plumper Sound, Bedwell Harbour).
- **Detail and gaps.** The scales disagree and overlap (the general scale has only 12 here); outlines nest under "Salish Sea" and "Puget Sound"; the set includes anchorages, banks and shoals that are not regions; and there are holes: a point off Port Angeles falls in no named area at any scale I queried, though "Strait of Juan de Fuca" polygons exist in some cells.
- **Licence.** Public domain, as the basemap's README already records for ENC Direct. Fits both uses.
- **Format and fetch.** A live ArcGIS service, updated weekly (decision 019). Fetch by date.
- **Fit.** The best source for US names with outlines, needing the most cleaning.

### Canadian Hydrographic Service charts

- The [Maritime Chart Service](https://open.canada.ca/data/en/dataset/12b769c8-48b8-4562-80fb-4a2e5ee9b45b) is under the Open Government Licence – Canada, but it serves rendered chart images, not vector features. The vector charts themselves are sold through licensed distributors; I found no open licence for them. Not usable, as NONNA's depths weren't (SalishSea.io decision 073).

### British Columbia Freshwater Atlas: Bays and Channels

- 2,618 polygons province-wide (`FWA_BAYS_AND_CHANNELS_POLY`): 1,624 marine bays and 664 marine channels, with names, under the Open Government Licence – British Columbia. They stop at the border (its Juan de Fuca Strait is 1,646 km², the Canadian half; its Haro Strait ends at 123.07°W), nest and overlap (Burrard Inlet holds Coal Harbour), and omit some features (I found no Howe Sound). CGNDB's outlines are better for this purpose because they cross the border; the two would need comparing feature by feature.

### WDFW's marine areas (Washington's catch-record areas)

- **What it provides.** 16 polygons that partition Washington's marine waters, each with a number and a name: 4 "Neah Bay", 5 "Sekiu and Pillar Point", 6 "East Juan de Fuca Strait", 7 "San Juan Islands", 8-1 "Deception Pass, Hope Island, and Skagit Bay", 8-2 "Ports Susan and Gardner", 9 "Admiralty Inlet", 10 "Seattle-Bremerton Area", 11 "Tacoma-Vashon Island", 12 "Hood Canal", 13 "South Puget Sound", and the ocean areas 1 to 3 ([WDFW Marine Areas service](https://geodataservices.wdfw.wa.gov/arcgis/rest/services/ApplicationServices/Marine_Areas/MapServer), layer 3; also the [Recreational Marine Areas item](https://www.arcgis.com/home/item.html?id=d43ba51491b94329a34b0b83dd43f54c)).
- **Detail.** Coarse: area 7 is 5,735 km² and runs from the San Juans to the border. Several names are fishing names rather than places ("Seattle-Bremerton Area", "Ilwaco").
- **Licence.** The ArcGIS item's terms-of-use field reads "None." and credits the Washington Department of Fish and Wildlife; the service's copyright reads "WDFW". No licence is named. The boundaries are defined in law, [WAC 220-311-010](https://app.leg.wa.gov/wac/default.aspx?cite=220-311-010), as lines between landmarks and coordinates, and the text of a regulation is generally not subject to copyright, so the polygons could be redrawn from the rule. That is a rights call for Peter, like D-24.
- **Fit.** A useful backbone or check for the US side's coarsest tier, not a source of names.

### DFO's Pacific Fishery Management Areas and subareas

- **What it provides.** 614 subarea polygons partitioning Canada's Pacific fisheries waters ([DFO service](https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/Pacific/DFO_BC_PFMA_SUBAREAS_50K_V3_1/MapServer)), each with a management area and subarea number (`19-5`, `29-10`) and no place name. The [DFO map index](https://www.pac.dfo-mpo.gc.ca/fm-gp/maps-cartes/areas-secteurs/index-eng.html) describes each area in a phrase ("Area 29 – lower Georgia Strait").
- **Licence.** None stated on DFO's service. The province's copy in the BC Data Catalogue (`dfo-fisheries-management-sub-areas`) is marked "Access Only", not open. I found no open.canada.ca record. The boundaries are defined in the [Pacific Fishery Management Area Regulations, 2007](https://laws-lois.justice.gc.ca/eng/regulations/SOR-2007-77/), and the [Reproduction of Federal Law Order](https://laws-lois.justice.gc.ca/eng/regulations/SI-97-5/page-1.html) lets anyone reproduce federal enactments "without charge or request for permission", provided the copy is accurate and not represented as official. So redrawing from the regulation would be clean, but laborious.
- **Fit.** Numbers, not names; useful only as boundaries between basins.

### Washington Department of Ecology: Salish Sea Model basins and oceanographic subbasins

- **Salish Sea Model basins** ([Ecology service](https://gis.ecology.wa.gov/hosting/rest/services/Hosted/SSM_Basins/FeatureServer/89)): 8 polygons, US waters only, 148 KB as GeoJSON: Admiralty Basin, Hood Canal, Main Basin, Northern Bays, South Sound, Strait of Georgia (the US part), Strait of Juan de Fuca (the US part, 2,533 km²) and Whidbey Basin. These are the divisions the Puget Sound science community uses, and the Encyclopedia of Puget Sound's definition, seen through a search summary, matches (Hood Canal, Main Basin with Admiralty Inlet, South Basin, Whidbey Basin). No licence is stated on the service, and its ArcGIS Online item was not accessible. The Washington Geospatial Portal record, seen only through a search summary, says the lines were drawn for display at about 1:1,500,000. Licence unverified; ask Ecology.
- **Oceanographic Subbasins** (Ecology's watershed characterization service, layer 3): 7 polygons that include land as well as water, such as "San Juan Islands and Georgia Strait" at 19,320 km². No fit.

### Watershed Boundary Dataset's marine units

- The open-water HUC12s listed above ("Port Orchard Sound", "Skagit Bay", "Rosario Strait-Strait of Juan De Fuca", "Port San Juan-Strait of Juan De Fuca" and so on) partition at least part of the US waters, and some reach Canadian waters in the Strait of Juan de Fuca. Public domain. I could fetch only three of about a dozen (the reference service returned errors for the rest), so I could not confirm how much of the Salish Sea they cover or how their edges meet Canada's waters. Their names are compound ("Haro Strait-Strait of Georgia") and their units coarse. A cheap boundary source for the US side worth checking in the 824 MB regional file.

### Marine Regions (VLIZ) and IHO S-23

- **IHO S-23, *Limits of Oceans and Seas*** (1953 edition): in the coverage area it has only "The Coastal Waters of Southeast Alaska and British Columbia", one area holding all the inside waters from Puget Sound north, plus the North Pacific Ocean. Marine Regions serves it under CC-BY. No use for subdivision.
- **Marine Regions' gazetteer** ([licence: CC-BY since 2019](https://www.marineregions.org/disclaimer.php)): records for Haro Strait, Puget Sound, Admiralty Inlet and others. Their polygons come from mixed sources: Haro Strait's is CGNDB's; Puget Sound's and Admiralty Inlet's were drawn by Marine Regions itself; the Strait of Georgia and the Strait of Juan de Fuca records have no polygon. It also holds 43 "IOS regions" from Fisheries and Oceans Canada's Institute of Ocean Sciences (Juan De Fuca, Tidal Mixed Region, Southern/Central/Northern Strait of Georgia, Howe Sound, Saanich Inlet and others): coarse polygons of about ten vertices, Canadian waters with Haro Strait included, nothing in Puget Sound. Useful as a second opinion on basin boundaries, not as the source.

### OpenStreetMap

- 1,194 named relations tagged as bays or straits within 125.5–122°W, 47–50.5°N (976 bays, 218 straits), including Haro Strait, Strait of Georgia, Strait of Juan de Fuca, Puget Sound, Admiralty Inlet, Rosario Strait, Boundary Pass, Saratoga Passage, Possession Sound and San Juan Channel; not Howe Sound under those tags. They nest and overlap. Under the [ODbL](https://opendatacommons.org/licenses/odbl/), which is share-alike: a partition built from them would itself be under the ODbL, and so would any database that combined it with SalishSea.io's other data, which the basemap already avoids by keeping OpenStreetMap-derived data in separate archives. Naming each sighting's region in the Darwin Core archive's `locality` field from an ODbL-derived partition would at least need a careful reading of whether the archive becomes a derived database. Best kept as a reference, not a source.

### Other science divisions

- **The Salish Sea bioregion boundary** (Aquila Flower, Western Washington University's Salish Sea Atlas; [hosted by DFO](https://egisp.dfo-mpo.gc.ca/arcgis/rest/services/Pacific/ssi_salish_sea_bioregion_boundary/MapServer)): the outer limit only, land and water, with a credit line ("Original analysis and cartography by Aquila Flower") and no licence found.
- **The Encyclopedia of Puget Sound's basin map**: found only by search; its map credits WDFW. Not checked further.

## Rights at a glance

| Source | Licence as published | Public tiles and archive? |
|---|---|---|
| 3DHP, WBD, NHDPlus HR | USGS public domain ([policy](https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits)); 3DHP service: "Use Constraints: None" | Yes; credit the USGS |
| BC Freshwater Atlas (watersheds, bays and channels) | [Open Government Licence – BC](https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61) | Yes, with credit; not share-alike |
| CGNDB outlines | [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada) | Yes, with credit |
| National Hydro Network, Canadian Hydrospatial Network | Open Government Licence – Canada | Yes, but no fit |
| NOAA ENC SEAARE | Public domain | Yes |
| CHS vector charts | Sold under licence; no open licence found | No |
| HydroBASINS v1 | Custom WWF licence; no stand-alone redistribution | No |
| HydroSHEDS v2 | Product page says CC-BY 4.0; defers to an agreement I did not find | Probably; verify |
| WDFW marine areas | Terms of use "None."; no licence named; boundaries in WAC 220-311-010 | Unclear; redraw from the rule, or ask |
| DFO fishery subareas | None stated by DFO; BC catalogue copy "Access Only"; boundaries in SOR/2007-77 | Not the file; redrawing from the regulation is permitted |
| Ecology Salish Sea Model basins | Not stated | Unknown; ask Ecology |
| Marine Regions | CC-BY (third-party geometries' terms not stated) | Yes, with credit |
| OpenStreetMap | ODbL, share-alike | Only if kept apart, as the basemap does |

A difference from D-24 worth noting: SWIFD and NuSEDS are used under D-24 as facts, with their geometry not reproduced. The sources recommended here are different: their licences let SalishSea.io publish their geometry, with credit. SWIFD's lines would still be used only to find which polygon belongs to which system, never drawn. A rights-policy entry for the new sources is needed either way (salish-7ds1.2 says so).

## Recommendations

### Watersheds

Use **NHDPlus High Resolution catchments in Washington and the Freshwater Atlas's Named Watersheds in British Columbia, with WBD HUC12s to fill each side's missing part across the border.**

- **British Columbia.** For each decision 020 river, take the Named Watershed whose trimmed `FWA_WATERSHED_CODE` equals the river's code. This needs no geometry matching and can't disagree with 020, because both read the same code.
- **Washington.** For each decision 020 system, match its outlet to the nearest NHDPlus HR reach at the coast, read the reach's `TerminalPa`, and dissolve every catchment with that value. Where 020 merges systems or names two rivers, merge their polygons the same way. If the work is wanted sooner, or in one evening, the Elwha alone can come straight from WBD's 10-digit unit `1711002005` (830.7 km²).
- **Across the border.** Add WBD's Canadian HUC12s to the Skagit (if NHDPlus HR's catchments stop at the border), and WBD's Sumas and Chilliwack units to the Fraser.
- **Later.** When 3DHP's elevation-derived catchments reach western Washington, swap them in for NHDPlus HR's; its flowlines already carry the same kind of terminal identifier.

Left to do by hand: check each of the 84 systems' polygons against its label once (especially systems 020 merged or named twice, and the small creeks near Port Angeles that WBD lumps); decide how to treat the vast basins (below); and write the rights-policy entry.

### Sea areas

Build the partition from **CGNDB outlines for the Canadian side and for straits shared with the US, and NOAA ENC named sea areas for US waters**, with the boundaries between the larger basins checked against WBD's marine units, the Salish Sea Model basins and DFO's subareas.

- Choose one tier of names that people use when they say where whales were: straits, channels, passages, sounds, inlets and large bays, but not coves, anchorages, banks or shoals. Within it, the smallest outline containing a point wins.
- Take each shared strait's outline from CGNDB alone, so the border doesn't split Haro Strait into two shapes with two names.
- Clip everything to the sea using the basemap's own water, and cut away overlaps.
- Fill the gaps: water that falls in no chosen outline (off Port Angeles, between Swanson Channel's point and its neighbours) is assigned to the nearest named outline, or drawn by hand where the nearest is plainly wrong.
- Outside the Salish Sea, the outer coast needs names of its own; WDFW's ocean areas and the open-ocean records of both charts are thin there, and "North Pacific Ocean" may have to be the fallback beyond the shelf.

Left to do by hand: the gap filling and the edges between basins (where Admiralty Inlet ends and the Main Basin begins is a convention, and the sources disagree); Puget Sound basin names, which the charts don't hold as outlines (the Salish Sea Model basins do, if Ecology's licence allows); Canadian features still recorded as points (Boundary Pass, Swanson Channel); and the French and Indigenous names, which need a decision on which name the card and the archive show.

## Questions for Peter

1. **How far should a watershed reach?** The Columbia's watershed reaches far into British Columbia, Idaho and Montana (commonly given as about 670,000 km²), and the Fraser's 231,525 km² reaches the Rockies. Should they be drawn whole, clipped to the coverage box, or stopped at some point upstream such as the first dam or the edge of the salmon's range?
2. **Which layer owns the watersheds?** The basemap already builds the river systems, so building the polygons there keeps them in step; the issue (salish-7ds1.2) leaves this open.
3. **Rights calls.** Is redrawing WDFW's marine areas from the WAC, or DFO's subareas from the federal regulation, acceptable to you as a basis? And is it worth asking Ecology for a licence for the Salish Sea Model basins?
4. **Which names count as a region?** Should a sighting in Penn Cove be "Penn Cove" or "Saratoga Passage"? The partition's tier decides what the card and `locality` say.
5. **Which name, in which language?** CGNDB records "Juan de Fuca Strait", "Détroit de Juan de Fuca" and Indigenous names, while NOAA records "Strait of Juan de Fuca". Which does a card show, and does the archive carry the others?
6. **The open ocean.** Is "North Pacific Ocean" (or "off the Washington coast") an acceptable region for sightings far offshore, or should the outer coast be divided too?

## What I could not verify

- Whether NHDPlus HR's catchment polygons extend into British Columbia over the upper Skagit.
- Whether `TerminalPa` joins decision 020's merged systems as expected; I described the method but didn't run it.
- The size and contents of 3DHP's national download, and any date for western Washington's elevation-derived mapping.
- How much of the Salish Sea WBD's marine HUC12s cover; most of them failed to download.
- The licence of the Salish Sea Model basins and of the Salish Sea bioregion boundary.
- Whether CGNDB's bulk downloads include outlines, or only the live service does.
- The full HydroSHEDS v2 licence agreement.
