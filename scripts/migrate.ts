/** Applies Drizzle migrations from ./drizzle to the configured SQLite file. */
import { closeDb, getDb, resolveDbPath } from "../src/db/client";

getDb();
console.log(`Migrations applied to ${resolveDbPath()}`);
closeDb();
