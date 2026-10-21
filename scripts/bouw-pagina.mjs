// Zet pagina/index.html in convex/pagina_html.ts, zodat Convex de pagina zelf
// kan serveren. Draait vanzelf bij `npm run uitrollen`.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const map = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(map, "pagina", "index.html"), "utf8");
const uit = `// NIET met de hand aanpassen: gemaakt door scripts/bouw-pagina.mjs uit pagina/index.html.\nexport const PAGINA_HTML = ${JSON.stringify(html)};\n`;
writeFileSync(join(map, "convex", "pagina_html.ts"), uit);
console.log(`pagina klaargezet (${Math.round(html.length / 1024)} kB)`);
