import express from "express";
import type { Request, Response } from "express";
import ViteExpress from "vite-express";
import type { FeatureCollection } from 'geojson';
import {fetchCurrentLocations, location2geojson} from './ferries.ts';

const app = express();

const collectFeatures = async () => {
  const ferries = await fetchCurrentLocations()
    .then(locations => locations.map(location2geojson));
  const collection: FeatureCollection = {
    type: 'FeatureCollection',
    features: ferries,
  };
  return collection;
};

app.get("/temporal-features", async (_req: Request, res: Response) => {
  const observations = await collectFeatures();
  res.contentType('application/geo+json');
  res.json(observations);
});

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
