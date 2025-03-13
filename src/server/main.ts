import express from "express";
import type { Request, Response } from "express";
import ViteExpress from "vite-express";
import type { FeatureCollection, Point } from 'geojson';
import * as ferries from './ferries.ts';
import type { FeatureProperties } from "./types.ts";
import { Temporal } from "temporal-polyfill";
import { query, matchedData, validationResult } from 'express-validator';

const app = express();

const collectFeatures = async (asof: Temporal.Instant) => {
  const locations = await ferries.locationsAsOf(asof);
  const collection: FeatureCollection<Point, FeatureProperties> = {
    type: 'FeatureCollection',
    features: locations,
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
    const insertionCount = await ferries.loadCurrentLocations();
    console.info(`Loaded ${insertionCount} ferry locations from WSF.`);
    res.send(`Loaded ${insertionCount} ferry locations from WSF.\n`);
  }
)

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
