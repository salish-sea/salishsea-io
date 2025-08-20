import express from "express";
import type { Request, Response } from "express";
import { query, matchedData, validationResult } from 'express-validator';
import { z } from "zod";
import { collectFeatures } from "./temporal-features.ts";
import type { TemporalFeaturesResponse, UpsertSightingResponse } from "../types.ts";
import { deleteSighting, upsertSighting } from "./sighting.ts";
import { getPresignedUserObjectURL } from "./storage.ts";
import { v7 } from "uuid";
import {auth} from 'express-oauth2-jwt-bearer';
import { storeUser } from "./user.ts";
import { Temporal } from "temporal-polyfill";
import './instrument.ts';
import * as Sentry from '@sentry/node';
import { sightingSchema } from "../api.ts";

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
    const observations: TemporalFeaturesResponse = collectFeatures(date);
    res.contentType('application/geo+json');
    res.header('Cache-Control', 'public, stale-if-error=14400');
    res.header('Date', new Date().toUTCString());
    res.json(observations);
  }
);

api.put(
  "/sightings/:sightingId",
  checkJwt,
  storeUser,
  (req: Request, res: Response) => {
    try {
      const validatedData = sightingSchema.parse(req.body);
      const updatedAt = new Date();
      const user = req.auth!.payload.sub!;

      const id = req.params.sightingId;
      if (!id)
        throw `Didn't find a sighting id!`;

      upsertSighting(id, validatedData, updatedAt, user);
      const response: UpsertSightingResponse = {id};
      res.status(201).json(response);
    } catch (error) {
      if (error instanceof z.ZodError) {
        res.status(400).json({ errors: error.issues });
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
    const deleted = deleteSighting(id, user);
    if (!deleted) {
      res.statusCode = 404;
      res.statusMessage = "Sighting not found or else owned by someone else";
      res.status(404);
    } else {
      const response: UpsertSightingResponse = {id};
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

Sentry.setupExpressErrorHandler(app);

declare module 'express' {
  interface Request {
    user_id?: number;
  }
}
