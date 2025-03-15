import express from "express";
import type { Request, Response } from "express";
import ViteExpress from "vite-express";
import type { FeatureCollection, Point } from 'geojson';
import * as ferries from './ferries.ts';
import * as maplify from './maplify.ts';
import type { FeatureProperties } from "./types.ts";
import { Temporal } from "temporal-polyfill";
import { query, matchedData, validationResult } from 'express-validator';

const app = express();

const collectFeatures = async (asof: Temporal.Instant) => {
  const now = Temporal.Now.zonedDateTimeISO('PST8PDT');
  const earlier = now.subtract({hours: 48}).withPlainTime(); // beginning of day, two days ago
  const collection: FeatureCollection<Point, FeatureProperties> = {
    type: 'FeatureCollection',
    features: [
      ...await maplify.sightingsBetween(earlier.toInstant(), now.toInstant()),
      ...await ferries.locationsAsOf(asof),
    ],
  };
  return collection;
};

app.get(
  "/temporal-features",
  query('t').notEmpty(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }

    const {t} = matchedData(req) as {t: string};
    const asOf = Temporal.Instant.from(t);
    const observations = await collectFeatures(asOf);
    res.contentType('application/geo+json');
    res.json(observations);
  }
);

app.post(
  "/fetch-ferry-locations",
  async (_req: Request, res: Response) => {
    const locations = await ferries.fetchCurrentLocations();
    const insertionCount = ferries.loadLocations(locations);
    console.info(`Loaded ${insertionCount} ferry locations from WSF.`);
    res.send(`Loaded ${insertionCount} ferry locations from WSF.\n`);
  }
);

app.post(
  "/fetch-maplify-sightings",
  query('earliest').notEmpty().custom(v => Temporal.PlainDate.from(v)),
  query('latest').notEmpty().custom(v => Temporal.PlainDate.from(v)),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }

    const {earliest, latest} = matchedData(req) as {earliest: Temporal.PlainDate, latest: Temporal.PlainDate};
    const sightings = await maplify.fetchSightings(earliest, latest);
    const insertionCount = maplify.loadSightings(sightings);
    console.info(`Loaded ${insertionCount} sightings from Maplify`);
    res.send(`Loaded ${insertionCount} sightings from Maplify`);
  }
);

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
