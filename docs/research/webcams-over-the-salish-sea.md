# Webcams over the Salish Sea

**Research date:** 2026-11-25 · **Author:** research by AI agents, checked against the cameras' own pages · **Status:** background/reference

This note asks which public webcams look over the Salish Sea and could appear on the map. For each camera it records who runs it, where it is and which way it faces, what its terms allow, and whether past images are kept. It also asks whether we may save frames when a whale is reported near a camera. Everything was checked on 2026-11-25 by fetching the pages and the image headers. No frames were saved. Cameras change hands and die often (several below had), so recheck a camera before relying on it.

## Summary

- **Few cameras give a wide view of open water on a whale route.** Four do: Lime Kiln (Haro Strait), the Saturna camera over Boundary Pass, Raincoast's camera on North Pender, and Skunk Bay (Admiralty Inlet). A few more are possible. Most "webcams" in this area show ferry docks, marinas, runways or roads.
- **Nearly every camera is live only.** Apart from YouTube's rewind window of a few hours, Skunk Bay's day of time-lapses, Race Rocks' archive and DriveBC's replay of the past day, nobody keeps past images. Images from the time of a whale report exist only if we save them then.
- **Almost no camera states a licence.** Most say nothing, or only "All rights reserved". Race Rocks says its images may not be used on other websites, and asks to approve even links. DriveBC publishes its list of cameras under the Open Government Licence – British Columbia, but the licence names the list, not the images.
- **Positions are mostly guesses.** Only WSDOT, DriveBC and the Saturna camera publish coordinates, and only Skunk Bay publishes which way it faces. Ask the operator before putting a camera on the map.

## Can we save frames when a whale is reported?

Technically it is easy. A still camera is one JPEG at a fixed URL, and a video stream is a playlist from which a frame a minute can be taken. Whether we may depends on what we do with the frame:

- **Reading an occurrence from a camera image is fine.** Copyright protects the picture, not the facts it shows. "Two killer whales heading north off Foulweather Bluff at 14:02, seen on Skunk Bay Cam1" is a fact we can publish under any licence. This is the ground the [rights policy](../rights-policy.md) already stands on for other facts (D-21, *Feist v. Rural*).
- **Saving frames only to make or check that record is probably fair use** in the US: the use is non-commercial, it takes facts rather than the picture's expression, and it doesn't compete with the camera. Canadian fair dealing covers research too, less clearly. No court has ruled on webcams in particular.
- **Republishing a frame needs a licence.** Showing a saved frame on a sighting's card or in the Darwin Core archive distributes the picture. We leave out unlicensed Maplify photos for the same reason (rights policy §1.4). A link to the camera's live page is always fine.
- **A site's terms can bind more tightly than copyright.** YouTube's terms forbid downloading except through YouTube's own features, so frames from Lime Kiln, Raincoast or Friday Harbor need the operator's permission and a feed of their own, not frames taken from YouTube. The Windy webcam API forbids redistribution and treats downloading much of a camera's history as misuse, so we should fetch cameras from their operators rather than through Windy. WSDOT says its camera list is "intended for 'low volume' use"; a few frames per report should fit.

So the plan that needs nobody's permission is: show the live camera, link to it, and record what people see on it. Race Rocks is the exception: its terms ask for approval even of a link, so ask Pearson College before listing it. Saving frames needs the operator's agreement for YouTube cameras and is advisable for the small private ones, whom we'd ask anyway since they are likely partners. If we start saving frames, the rule belongs in the rights policy and gets a decision record.

## Cameras on whale routes

| Camera | Run by | Water it covers | What it serves | Past images | Terms |
|---|---|---|---|---|---|
| Lime Kiln lighthouse | The Whale Museum | Haro Strait, the west side of San Juan Island | YouTube live, 1080p | YouTube's rewind window (length not checked) | None stated for the camera. Its hydrophone data is CC BY-NC-SA 4.0 |
| Saturna "Live Ship Spotting" | A private owner on MyEarthCam | Boundary Pass | Video stream, 1080p, open to other sites | None (`archiveon:false`) | None stated beyond EarthCam's site terms |
| Pender Underwater Listening Station | Raincoast Conservation Foundation | North Pender, in the sanctuary zone for Southern Residents (Swanson Channel or Boundary Pass) | YouTube live, 1080p | YouTube's rewind window | None stated |
| Skunk Bay Cam1 | Greg Johnson, privately | Admiralty Inlet, from Hansville | JPEG every 2 minutes, up to 1920×1080 | Time-lapses of the last 3 hours and of the previous day | None stated |
| Langley Whale Cam | Whidbey Telecom | Saratoga Passage | Video stream (we could not connect to it) | None stated | None stated |
| Race Rocks | Pearson College | Eastern Strait of Juan de Fuca | Cameras viewers can steer; low bandwidth | Archived video | No use on other websites; links need approval |
| East Passage, Burien | Orca Conservancy | Between the mainland and Vashon, KVI Beach to Blake Island | No stream link found | None found | None found |

### Lime Kiln lighthouse (The Whale Museum)

- Page: <https://whalemuseum.org/pages/seasound-remote-sensing-network>. Stream: <https://www.youtube.com/thewhalemuseum/live>. Use the `/live` address, because the video id changes when the stream restarts; Friends of Lime Kiln's link to an older id is dead.
- The YouTube description says the camera is "paid for and maintained by The Whale Museum". SkylineWebcams shows the same stream without credit.
- Position about 48.516, −123.152, from the lighthouse's location, not from the museum. The direction it faces is not published; west over Haro Strait is a guess.
- The best camera found: it is on the main summer route of the Southern Residents.

### Saturna "Live Ship Spotting" (Boundary Pass)

- Page: <https://myearthcam.com/randor10>. The page offers an HLS stream at 1920×1080 that other sites may load.
- The owner entered the position 48.780, −123.070, on Saturna's south shore. The page says it "overlooks the Boundary Pass" and mentions orcas, humpbacks, ships labelled from AIS, and hydrophone audio. The direction it faces is a guess (south or southwest).
- The owner isn't named. The page doesn't name the Saturna Island Marine Research & Education Society either, so don't assume the audio is theirs. The only contact route found is EarthCam.

### Pender Underwater Listening Station (Raincoast)

- Stream: <https://www.youtube.com/watch?v=v6YhBAIJqGM>; page <https://www.raincoast.org/whale-livestream/>; announcement <https://www.raincoast.org/press/new-camera-hydrophone-monitor-whales-pender-island/>.
- A hydrophone station first, with a camera above water. Live since 2023-09-26; Raincoast said in 2024 that it ran intermittently.
- Position and direction are not published. Look at the frame before relying on it.

### Skunk Bay Cam1 (Hansville)

- Page: <https://www.skunkbayweather.com/SkunkBayWebcam.html>. Image: `http://www.skunkbayweather.com/Cam1/Cam1_1920x1080.jpg` (also `Cam1_1024x576.jpg`). The site refuses requests without a browser-like User-Agent.
- The owner's [About page](https://www.skunkbayweather.com/About.html) says the cameras take a picture every 20 seconds and upload one every 2 minutes, and that time-lapses of the last 3 hours and of the previous day are uploaded (`Cam1/Intraday_Video_1280x720_Cam1.mp4`, `Cam1/Video_1280x720_Cam1.mp4`).
- Cam2 and Cam3 have not updated since August 2024. A banner on the home page says a camera "appears to have died".
- Position about 47.919, −122.556, from the forecast link on the home page. The owner's [orientation diagram](http://skunkbayweather.com/CamOrientation.JPG) shows Cam1 facing roughly north-northwest, across Admiralty Inlet toward Port Townsend and Marrowstone Island.
- The owner links Orca Network and Orcasound, and lists TV stations and news sites that have used his images.

### Langley Whale Cam (Whidbey Telecom)

- Page: <https://www.whidbeytel.com/cams/langley-whale-cam/>, which gives 48.0407, −122.4075 and says the camera "faces Saratoga Passage". The stream is `https://streamingserv.whidbey.net/hls/whalecam_baseline_854480_hls.m3u8`; we could not complete a TLS connection to it, so whether it works is unknown.

### Race Rocks (Pearson College)

- Pages: <https://racerocks.ca/video-cameras/>, archive <https://racerocks.ca/archived-video/>, terms <https://racerocks.ca/copyright/>: teachers and students may use its material in class without asking, with acknowledgement. Asked "May I use images or materials on a web site", it answers "No, but you may link with permission to educational websites", and of links it says "We welcome relevant non-commercial educational links. Please contact for approval." Permission requests go to Pearson College's administration, named on that page.
- The site asks viewers not to leave cameras running in the background, because the link to the island is a low-bandwidth microwave relay. Even with approval, link to it rather than load it.

### East Passage, Burien (Orca Conservancy)

- Page: <https://www.orcaconservancy.org/east-passage-live-webcam>. It says the camera runs around the clock and sees about 3.5 miles, from KVI Beach on Vashon to Blake Island. No stream link was on the page.

## Cameras that mostly show docks, harbours, runways or roads

These are easy to fetch and some show water in the background, but they are poor for spotting whales. Look at each image before listing one.

- **WSDOT and Washington State Ferries.** A public ArcGIS layer lists the cameras with their positions, a compass letter and the image URL, and needs no key: `https://data.wsdot.wa.gov/arcgis/rest/services/TravelInformation/TravelInfoCamerasWeather/FeatureServer/0/query?where=1=1&outFields=*&outSR=4326&f=json` (743 cameras in a box around Puget Sound). The layer says images refresh about every 5 minutes, and its licence text says the feed "is intended for 'low volume' use" and WSDOT "may cancel or restrict access for any reason". The site's copyright line is "All Rights Reserved". WSDOT keeps no archive. Ferry terminal cameras mostly face the holding lanes; the two Hood Canal Bridge cameras face east and west along the bridge; the Tacoma Narrows cameras show traffic with a strip of water. The [Traveler Information API](https://wsdot.wa.gov/traffic/api) gives the same list with a free access code.
- **WSDOT Aviation airport cameras** at Friday Harbor, Orcas and Lopez (`https://images.wsdot.wa.gov/airports/friday1.jpg` and similar), every 15 minutes: runways with water behind.
- **Skagit County, Anacortes–Guemes ferry.** [Ferry tracking cameras](https://www.skagitcountywa.gov/services/roads-and-transportation/ferry/ferry-tracking-cameras/), three JPEGs refreshed every 30 seconds. Positions and directions not published. No terms, no archive.
- **Pierce County, Steilacoom–Anderson Island ferry.** [Ferry webcams](https://www.piercecountywa.gov/7140/Ferry-Webcams), four 320×180 JPEGs refreshed every 60 seconds, showing the docks.
- **Hood Canal Communications, Union.** [Tower and water cams](https://www.hcc.net/about-us/community-links/tower-and-water-cams/): a water camera and a boat-launch camera at Hood Canal Marina, and a tower camera looking over the canal toward Hoodsport, refreshed every 60 seconds. The site blocks automated requests, so the image URLs are still unknown. A private company: ask.
- **Port of Friday Harbor** marina camera, YouTube live (<https://www.youtube.com/watch?v=pr2p_uvmXh8>): the harbour and the ferry lane.
- **BC Ferries** terminal cameras (<https://www.bcferries.com/current-conditions/webcams>), for example `https://ccimg.bcferries.com/cc/support/terminals/cam1_SWB.jpg` for Swartz Bay: vehicle staging areas.
- **DriveBC.** `https://www.drivebc.ca/api/webcams/` lists 1,072 cameras with position, direction and refresh period; images at `https://www.drivebc.ca/images/{id}.jpg`, and a replay of the past day per camera. The [dataset](https://catalogue.data.gov.bc.ca/dataset/bc-highwaycams) is under the [Open Government Licence – British Columbia](https://www2.gov.bc.ca/gov/content?id=A519A56BC2BF44E4A008B33FCF527F61), which allows copying and publishing "for any lawful purpose" with attribution. The licence covers "a list of the locations, web addresses and attributes" of the cameras, not the images, and the list carries a credit field per camera, so the rights in the images themselves are not settled. Nearly all show roads; a few along Howe Sound (Lions Bay, Furry Creek, Britannia, Horseshoe Bay) might show water.
- **Roche Harbor, Eastsound, Lopez Islander and others on HDOnTap**: commercial streams of marinas and bays, with tokens.
- **FOX 13 Tacoma Narrows**: a commercial stream behind a token that expires after 30 minutes, with a sponsor's overlay. Not usable.

## Dead, or not usable

- **Point No Point lighthouse** (United States Lighthouse Society): the image has been frozen since 2026-03-26.
- **DestiCam** (Lime Kiln, Island Inn, Orcas Hotel): every camera stale since 2025 or earlier.
- **Port Angeles harbour** YouTube stream: ended. **Orcas Island Yacht Club** (West Sound) on Camstreamer: shows an error. **Ganges Harbour** on Windfinder and **Van Isle Marina** (Sidney): stale.
- **NAV CANADA weather camera, Saturna East Point**: behind bot protection, so we could not see what it shows. It is a weather camera and faces north.
- **Windy, SkylineWebcams, worldcam.eu, earthTV, Windfinder, webcamtaxi**: they show other people's cameras and are not operators. Trace a camera to whoever runs it before using it. The Windy API's [terms](https://api.windy.com/webcams/terms) forbid redistributing images and make image links expire after 10 to 15 minutes on the free tier.

## Gaps

No working camera over open water was found for Active Pass, Port Townsend and Point Wilson, Point Robinson, Alki, Edmonds (the Port of Edmonds marina camera refused automated requests), Ogden Point, Sooke, Rosario Strait, Mayne, Galiano, Salt Spring, or the Sidney and Saanich shore. Orcasound's stations, the Port Townsend Marine Science Center and the Saturna society's stations are hydrophones only. Ocean Networks Canada's cameras are underwater. Someone with a browser could look over Windy's map for these places, then trace what they find to its operator.

## Who to ask, in order

1. The Whale Museum, for Lime Kiln: permission to save frames, a feed of their own, and the camera's position and direction.
2. Greg Johnson, for Skunk Bay: permission, Cam1's exact position and direction, and whether he keeps the 20-second frames.
3. Raincoast, for the Pender camera: its position and direction, and permission.
4. The Saturna camera's owner, through EarthCam: who they are, and permission.
5. Pearson College, for Race Rocks: approval to link to its cameras.

Contacts are on each operator's page linked above.
