import express from "express";
import type { Request, Response } from "express";
import type { Feature, FeatureCollection, Geometry } from 'geojson';
import { query, matchedData, validationResult } from 'express-validator';
import { z } from "zod";
import { imputeTravelLines } from "./travel.ts";
import { sightingsBetween } from "./temporal-features.ts";
import type { FeatureProperties, UpsertSightingResponse } from "../types.ts";
import { deleteSighting, upsertSighting } from "./sighting.ts";
import { getPresignedUserObjectURL } from "./storage.ts";
import { v7 } from "uuid";
import {auth} from 'express-oauth2-jwt-bearer';
import { storeUser } from "./user.ts";
import { makeT } from "./database.ts";
import { Temporal } from "temporal-polyfill";
import * as ferries from './ferries.ts';

export const app = express();

const sessionSecret = process.env.SESSION_SECRET || 'test-secret';
if (!sessionSecret)
  throw "Please set a session secret in SESSION_SECRET";

app.set('trust proxy', 'loopback'); // https://expressjs.com/en/guide/behind-proxies.html

const api = express.Router();
api.use(express.json());
api.use(express.urlencoded({limit: '50mb'}));
app.use('/api', api);

const checkJwt = auth({
  audience: process.env.VITE_AUTH0_AUDIENCE,
  authRequired: true,
  issuerBaseURL: `https://${process.env.VITE_AUTH0_DOMAIN}`,
});

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

    const dbt = makeT();
    const {d} = matchedData(req) as {d: string};
    const date = Temporal.PlainDate.from(d);
    const observations = collectFeatures(date);
    res.contentType('application/geo+json');
    res.header('Cache-Control', 'public, stale-if-error=14400');
    res.header('Date', new Date().toUTCString());
    res.json(observations);
  }
);

const sightingSchema = z.object({
  body: z.string(),
  count: z.number().optional().nullish(),
  direction: z.string().nullable(),
  license_code: z.string(),
  observed_at: z.number(),
  observer_location: z.tuple([z.number(), z.number()]).nullable(),
  photo: z.array(z.string()).default([]),
  subject_location: z.tuple([z.number(), z.number()]),
  taxon: z.string(),
  url: z.string().trim().nullish(),
});
api.put(
  "/sightings/:sightingId",
  checkJwt,
  storeUser,
  (req: Request, res: Response) => {
    try {
      const validatedData = sightingSchema.parse(req.body);
      const t = makeT();
      const user = req.auth!.payload.sub!;

      const sighting = {...validatedData, id: req.params.sightingId!};

      upsertSighting(sighting, t, t, user);
      const response: UpsertSightingResponse = {id: sighting.id, t};
      res.status(201).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.errors });
      } else {
        console.log(error);
        res.status(500).json({ error: "Internal server error" });
      }
    }
  }
);

api.delete(
  "/sightings/:sightingId",
  checkJwt,
  (req: Request, res: Response) => {
    const id = req.params.sightingId!;
    const user = req.auth!.payload.sub!;
    const t = makeT();
    const deleted = deleteSighting(id, user);
    if (!deleted) {
      res.statusCode = 404;
      res.statusMessage = "Sighting not found or else owned by someone else";
      res.status(404);
    } else {
      const response: UpsertSightingResponse = {id, t};
      res.status(200).json(response);
    }
  }
)

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

declare module 'express' {
  interface Request {
    user_id?: number;
  }
}
