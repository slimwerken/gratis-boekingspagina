// Koppelt je agenda en zet de sleutels in de Convex-omgeving. Geen sleutel komt
// in een bestand of op je scherm.
//
//   node scripts/koppel.mjs google --client-id <id> --client-secret <geheim>
//       Opent je browser. Log in, klik door het waarschuwingsscherm en geef toestemming.
//       Lukt het terugsturen niet? Plak de hele adresregel uit je browser:
//       node scripts/koppel.mjs google --client-id <id> --client-secret <geheim> --url "<adres>"
//
//   node scripts/koppel.mjs microsoft --client-id <id> [--tenant <tenant-id>]
//       Laat een korte code zien. Open microsoft.com/devicelogin, tik de code in en log in.
//
//   node scripts/koppel.mjs sleutel
//       Maakt je beheersleutel (om zelf af te zeggen en te verzetten) en laat hem een keer zien.
//
// Standaard gaat alles naar je live omgeving (production). Met --dev naar de testomgeving.
import http from "node:http";
import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const MAP = join(dirname(fileURLToPath(import.meta.url)), "..");
const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];
const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite", "Mail.Send"];

const args = process.argv.slice(2);
const soort = args[0];
// Een optie van de opdrachtregel, of anders uit de omgeving (GOOGLE_CLIENT_ID enz.),
// zodat een geheim niet in je geschiedenis hoeft te staan.
const ENV = { "client-id": soort === "microsoft" ? "MICROSOFT_CLIENT_ID" : "GOOGLE_CLIENT_ID", "client-secret": "GOOGLE_CLIENT_SECRET", tenant: "MICROSOFT_TENANT" };
const optie = (naam) => { const i = args.indexOf(`--${naam}`); return i >= 0 ? args[i + 1] : (ENV[naam] ? process.env[ENV[naam]] : undefined); };
const DEV = args.includes("--dev");

function stop(tekst) { console.error(`\n✗ ${tekst}\n`); process.exit(1); }

/** Zet een waarde in de Convex-omgeving. De waarde gaat via stdin, zodat hij
 *  niet in je geschiedenis of in de lijst met lopende programma's staat. */
function zetInConvex(naam, waarde) {
  const r = spawnSync("npx", ["convex", "env", "set", ...(DEV ? [] : ["--prod"]), "--force", naam], {
    cwd: MAP, encoding: "utf8", input: waarde, shell: process.platform === "win32",
  });
  if (r.status !== 0) stop(`Convex wilde ${naam} niet opslaan:\n${(r.stderr || r.stdout || "").slice(-600)}`);
  console.log(`  ✓ ${naam} staat in Convex (${DEV ? "testomgeving" : "live"})`);
}

function openBrowser(url) {
  if (args.includes("--niet-openen")) return;
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const a = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try { spawn(cmd, a, { stdio: "ignore", detached: true }).unref(); } catch { /* dan klikt de gebruiker de link */ }
}

async function formPost(url, velden) {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(velden) });
  return r.json().catch(() => ({}));
}

// ─── Google: inloggen in je browser, terug naar deze computer ───────────────

async function google() {
  const id = optie("client-id"), geheim = optie("client-secret");
  if (!id || !geheim) stop("Geef --client-id en --client-secret mee (uit Google Cloud, Clients).");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(16).toString("hex");

  let code, redirect;
  const geplakt = optie("url");
  if (geplakt) {
    const u = new URL(geplakt);
    code = u.searchParams.get("code");
    redirect = `${u.protocol}//${u.host}`;
    if (!code) stop("In dat adres staat geen code. Plak de hele regel uit je browser, met code= erin.");
  } else {
    ({ code, redirect } = await new Promise((klaar, mis) => {
      let poort = 0; // vastleggen bij het starten: na server.close() is het adres weg
      const server = http.createServer((req, res) => {
        const u = new URL(req.url, "http://127.0.0.1");
        if (!u.searchParams.has("code") && !u.searchParams.has("error")) { res.writeHead(404); res.end(); return; }
        const fout = u.searchParams.get("error");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><body style="font-family:system-ui;padding:40px;max-width:520px">
          <h2>${fout ? "Dat lukte niet" : "Gelukt!"}</h2><p>${fout ? "Google gaf: " + fout + ". Ga terug naar Claude." : "Je agenda is gekoppeld. Je mag dit tabblad sluiten en teruggaan naar Claude."}</p>`);
        server.close();
        if (fout) mis(new Error(`Google gaf: ${fout}`));
        else if (u.searchParams.get("state") !== state) mis(new Error("Het antwoord van Google hoort niet bij deze poging. Probeer het opnieuw."));
        else klaar({ code: u.searchParams.get("code"), redirect: `http://127.0.0.1:${poort}` });
      });
      server.listen(0, "127.0.0.1", () => {
        const port = poort = server.address().port;
        const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
          client_id: id, redirect_uri: `http://127.0.0.1:${port}`, response_type: "code",
          scope: GOOGLE_SCOPES.join(" "), access_type: "offline", prompt: "consent",
          code_challenge: challenge, code_challenge_method: "S256", state,
        });
        console.log("\nJe browser gaat open. Gebeurt dat niet, open dan deze link:\n\n" + url + "\n");
        console.log("Zie je 'Google heeft deze app niet geverifieerd'? Dat klopt: het is je eigen app.");
        console.log("Klik op 'Geavanceerd' en daarna op 'Ga naar ... (onveilig)', en vink alles aan.\n");
        openBrowser(url);
      });
      setTimeout(() => { server.close(); mis(new Error("Na tien minuten nog geen antwoord van Google. Probeer het opnieuw.")); }, 10 * 60_000).unref();
    }).catch((e) => stop(e.message)));
  }

  const d = await formPost("https://oauth2.googleapis.com/token", {
    client_id: id, client_secret: geheim, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirect,
  });
  if (!d.refresh_token) stop(`Google gaf geen blijvende toegang terug: ${d.error ?? ""} ${d.error_description ?? ""}`);
  const ontbreekt = GOOGLE_SCOPES.filter((s) => !(d.scope ?? "").split(" ").includes(s));
  if (ontbreekt.length) stop(`Je hebt niet alle vinkjes aangezet. Ontbreekt: ${ontbreekt.join(", ")}. Doe de koppeling opnieuw en vink alles aan.`);

  // Bewijs: kan hij in de agenda kijken?
  const nu = new Date();
  const fb = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST", headers: { Authorization: `Bearer ${d.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin: nu.toISOString(), timeMax: new Date(+nu + 7 * 864e5).toISOString(), items: [{ id: "primary" }] }),
  }).then((r) => r.json());
  if (!fb.calendars) stop(`Gekoppeld, maar de agenda gaf een fout: ${JSON.stringify(fb).slice(0, 300)}`);
  console.log(`\n✓ Google gekoppeld. In je agenda staan de komende 7 dagen ${fb.calendars.primary?.busy?.length ?? 0} bezette blokken.`);

  zetInConvex("GOOGLE_CLIENT_ID", id);
  zetInConvex("GOOGLE_CLIENT_SECRET", geheim);
  zetInConvex("GOOGLE_REFRESH_TOKEN", d.refresh_token);
}

// ─── Microsoft: een code intikken op microsoft.com/devicelogin ──────────────

async function microsoft() {
  const id = optie("client-id");
  const tenant = optie("tenant") || "common";
  if (!id) stop("Geef --client-id mee (Application (client) ID uit Microsoft Entra).");
  const basis = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0`;
  const start = await formPost(`${basis}/devicecode`, { client_id: id, scope: MICROSOFT_SCOPES.join(" ") });
  if (!start.device_code) {
    const t = `${start.error ?? ""} ${start.error_description ?? ""}`;
    if (/AADSTS7000218|public client/i.test(t)) stop("Zet in Microsoft Entra bij je app onder Authentication de optie 'Allow public client flows' op Yes, en probeer het opnieuw.");
    stop(`Microsoft weigerde: ${t.slice(0, 400)}`);
  }
  console.log(`\nOpen ${start.verification_uri} en tik deze code in:\n\n    ${start.user_code}\n\nLog in met het account van je agenda en geef toestemming.\n`);
  openBrowser(start.verification_uri);
  const tot = Date.now() + (start.expires_in ?? 900) * 1000;
  let wacht = (start.interval ?? 5) * 1000;
  let d;
  while (Date.now() < tot) {
    await new Promise((r) => setTimeout(r, wacht));
    d = await formPost(`${basis}/token`, { client_id: id, grant_type: "urn:ietf:params:oauth:grant-type:device_code", device_code: start.device_code });
    if (d.access_token) break;
    if (d.error === "slow_down") wacht += 5000;
    else if (d.error !== "authorization_pending") stop(`Microsoft weigerde: ${d.error} ${String(d.error_description ?? "").slice(0, 300)}`);
  }
  if (!d?.refresh_token) stop("Geen toestemming binnen de tijd. Probeer het opnieuw.");

  const ik = await fetch("https://graph.microsoft.com/v1.0/me", { headers: { Authorization: `Bearer ${d.access_token}` } }).then((r) => r.json());
  const agenda = await fetch("https://graph.microsoft.com/v1.0/me/calendar?$select=name,allowedOnlineMeetingProviders", { headers: { Authorization: `Bearer ${d.access_token}` } }).then((r) => r.json());
  if (!agenda.name) stop(`Gekoppeld, maar de agenda gaf een fout: ${JSON.stringify(agenda).slice(0, 300)}`);
  const teams = (agenda.allowedOnlineMeetingProviders ?? []).includes("teamsForBusiness");
  console.log(`\n✓ Microsoft gekoppeld als ${ik.userPrincipalName ?? ik.mail ?? "?"}, agenda "${agenda.name}".`);
  console.log(teams ? "  Teams-links kunnen automatisch mee." : "  Let op: dit account kan geen Teams-links maken (dat kan alleen met Microsoft 365 voor bedrijven). Zet bij je soorten afspraken een locatie, bijvoorbeeld 'Ik bel je'.");

  zetInConvex("MICROSOFT_CLIENT_ID", id);
  zetInConvex("MICROSOFT_TENANT", tenant);
  zetInConvex("MICROSOFT_REFRESH_TOKEN", d.refresh_token);
}

// ─── Beheersleutel ──────────────────────────────────────────────────────────

function sleutel() {
  const s = crypto.randomBytes(18).toString("base64url");
  zetInConvex("BEHEER_SLEUTEL", s);
  console.log(`\nJe beheersleutel (bewaar hem in je wachtwoordmanager):\n\n    ${s}\n\nDie vul je een keer in als je via de link "Afzeggen of verzetten" in een agenda-item komt.\n`);
}

if (soort === "google") await google();
else if (soort === "microsoft") await microsoft();
else if (soort === "sleutel") sleutel();
else stop("Gebruik: node scripts/koppel.mjs google|microsoft|sleutel (zie bovenaan dit bestand).");
