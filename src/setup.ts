import { db, loadSchema, loadTaxa } from "./server/database.ts";

loadSchema(db);
loadTaxa(db);
