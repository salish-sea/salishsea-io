import ViteExpress from "vite-express";
import { app } from "./app.ts";
import { loadFerries, loadRecent } from "./sources.ts";


await loadRecent();
await loadFerries();
setInterval(loadRecent, 1000 * 60 * 5);
setInterval(loadFerries, 1000 * 60);

const port = 3131;
ViteExpress.listen(app, port, () => console.debug(`Listening on port ${port}.`));
