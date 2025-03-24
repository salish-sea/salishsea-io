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

const app = express();

// https://github.com/salish-sea/acartia/wiki/1.-Context-for-SSEMMI-&-Acartia#spatial-boundaries-related-to-acartia
const extentOfInterest: Extent = [-136, 36, -120, 54];

const collectFeatures = async (date: Temporal.PlainDate, time?: Temporal.PlainTime) => {
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

app.get(
  "/temporal-features",
  query('d').notEmpty(),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }

    const {d} = matchedData(req) as {d: string};
    const date = Temporal.PlainDate.from(d);
    const observations = await collectFeatures(date);
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
    console.info(`Loaded ${insertionCount} sightings from Maplify.`);
    res.send(`Loaded ${insertionCount} sightings from Maplify.\n`);
  }
);

app.post(
  "/fetch-inaturalist-observations",
  query('taxa').notEmpty().custom((v: string) => v.split(',').map(id => parseInt(id, 10))),
  query('earliest').notEmpty().custom(v => Temporal.PlainDate.from(v)),
  query('latest').notEmpty().custom(v => Temporal.PlainDate.from(v)),
  async (req: Request, res: Response) => {
    const errors = validationResult(req);
    if (! errors.isEmpty()) {
      res.send({errors: errors.array()});
      return;
    }

    const {taxa, earliest, latest} = matchedData(req) as {taxa: number[], earliest: Temporal.PlainDate, latest: Temporal.PlainDate};
    const observations = await inaturalist.fetchObservations({earliest, extent: extentOfInterest, latest, taxon_ids: taxa})
    const insertionCount = await inaturalist.loadObservations(observations);
    console.info(`Loaded ${insertionCount} observations from iNaturalist.`);
    res.send(`Loaded ${insertionCount} observations from iNaturalist.\n`);
  }
);

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
