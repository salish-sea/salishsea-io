import ViteExpress from "vite-express";
import { app } from "./app.ts";
import { loadRecent } from "./sources.ts";


await loadRecent();
setInterval(loadRecent, 1000 * 60 * 5);

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
