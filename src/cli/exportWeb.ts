// yarn export:web
// Writes web/public/anonai.json: the public facts the dashboard needs. Never secrets. Run after setup or after
// registering agents, then rebuild the site.
import fs from "node:fs";
import path from "node:path";
import { repoRoot } from "../lib/config.js";
import { publicFacts } from "../lib/facts.js";

const file = path.join(repoRoot, "web", "public", "anonai.json");
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(publicFacts(), null, 2) + "\n");
console.error(`wrote ${file}`);
