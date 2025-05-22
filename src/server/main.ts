import express from "express";
import type { Request, Response } from "express";
import ViteExpress from "vite-express";
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import * as ferries from './ferries.ts';
import * as maplify from './maplify.ts';
import * as inaturalist from './inaturalist.ts';
import { Temporal } from "temporal-polyfill";
import { query, matchedData, validationResult } from 'express-validator';
import { imputeTravelLines } from "./travel.ts";
import { sightingsBetween } from "./temporal-features.ts";
import type { Extent, FeatureProperties } from "../types.ts";
import { upsertSighting } from "./sighting.ts";
import { getPresignedUserObjectURL } from "./storage.ts";
import { v7 } from "uuid";
import {auth} from 'express-oauth2-jwt-bearer';

const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret)
  throw "Please set a session secret in SESSION_SECRET";

const app = express();
app.set('trust proxy', 'loopback'); // https://expressjs.com/en/guide/behind-proxies.html

const api = express.Router();
api.use(express.json());
api.use(express.urlencoded({limit: '50mb'}));
app.use('/api', api);

const checkJwt = auth({
  audience: process.env.AUTH0_AUDIENCE,
  authRequired: false,
  issuerBaseURL: `https://${process.env.VITE_AUTH0_DOMAIN}`,
});

// https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
const extentOfInterest: Extent = [-136, 36, -120, 54];

const collectFeatures = (date: Temporal.PlainDate, time?: Temporal.PlainTime) => {
  const earliest = date.toZonedDateTime('PST8PDT');
  const latest = earliest.add({hours: 24});
  const sightings = sightingsBetween(earliest.toInstant(), latest.toInstant());
  const travelLines = imputeTravelLines(sightings);
  const features: Feature<Geometry, FeatureProperties>[] = [
    ...sightings,
    ...travelLines,
  ];
  if (time) {
    const asOf = date.toZonedDateTime({timeZone: 'PST8PDT', plainTime: time});
    const ferryLocations = ferries.locationsAsOf(asOf.toInstant());
    features.concat(ferryLocations);
  }
  const collection: FeatureCollection<Geometry> = {
    type: 'FeatureCollection',
    features,
  };
  return collection;
};

api.get(
  "/temporal-features",
  query('d').notEmpty(),
  (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }

    const {d} = matchedData(req) as {d: string};
    const date = Temporal.PlainDate.from(d);
    const observations = collectFeatures(date);
    res.contentType('application/geo+json');
    res.header('Cache-Control', 'must-revalidate, public, max-age=3600');
    res.json(observations);
  }
);

api.put(
  "/sightings/:sightingId",
  checkJwt,
  (req: Request, res: Response) => {
    const id = req.params.sightingId!;
    const sighting = req.body;
    upsertSighting({...sighting, id});
    res.status(201).json(sighting);
  }
);

api.get(
  "/sightings/:sightingId/uploadUrl",
  checkJwt,
  query('contentLength').isNumeric(),
  query('contentType').isMimeType(),
  query('fileName').notEmpty(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }
    const sid = v7();
    const {contentLength, contentType, fileName} = matchedData(req) as {contentLength: string, contentType: string, fileName: string};
    const presignedUrl = await getPresignedUserObjectURL(sid, fileName, contentType, parseInt(contentLength, 10));
    res.contentType('text/plain').send(presignedUrl);
  }
);

const loadRecent = async () => {
  try {
    const earliest = Temporal.Now.plainDateISO().subtract({hours: 240});
    const latest = Temporal.Now.plainDateISO().add({hours: 24});
    const sightings = await maplify.fetchSightings(earliest, latest, extentOfInterest);
    const sightingsInserted = maplify.loadSightings(sightings);
    console.info(`Loaded ${sightingsInserted} sightings from Maplify.`);

    const observations = await inaturalist.fetchObservations({earliest, extent: extentOfInterest, latest, taxon_ids: [152871]});
    const observationsInserted = await inaturalist.loadObservations(observations);
    console.info(`Loaded ${observationsInserted} sightings from iNaturalist.`);
  } catch (e) {
    console.error(`Error loading sightings: ${e}`);
  }
};

const loadFerries = async () => {
  try {
    const locations = await ferries.fetchCurrentLocations();
    const insertionCount = ferries.loadLocations(locations);
    console.info(`Loaded ${insertionCount} ferry locations from WSF.`);
  } catch (e) {
    console.error(`Error loading ferry locations: ${e}`);
  }
};

await loadRecent();
await loadFerries();
setInterval(loadRecent, 1000 * 60 * 5);
setInterval(loadFerries, 1000 * 60);

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));

declare module 'express' {
  interface Request {
    user_id?: number;
  }
}
