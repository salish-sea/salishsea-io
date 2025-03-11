import express from "express";
import type { Request, Response } from "express";
import ViteExpress from "vite-express";

const app = express();

app.get("/observations", (req: Request, res: Response) => {
  console.log(`Earliest: ${req.query.earliest}`);
  console.log(`Latest: ${req.query.latest}`);
  console.log(`Taxon: ${req.query.taxon}`);
  res.send("Here are your observations!");
});

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
