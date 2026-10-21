// De ingang van buitenaf: de pagina zelf en de routes waar hij mee praat.
//
// Pagina (door Convex zelf geserveerd, dus geen hosting nodig):
//   GET  /                       overzicht van je soorten afspraken
//   GET  /<slug>                 boeken
//   GET  /beheer/<token>         verzetten of annuleren
// API:
//   GET  /api/pagina             naam, kleuren, teksten voor de pagina
//   GET  /api/soorten            zichtbare soorten afspraken
//   GET  /api/soort?slug=        een soort met zijn vragen
//   GET  /api/tijden?slug=&van=&tot=   vrije starttijden (ms UTC), van/tot als JJJJ-MM-DD
//   POST /api/boek               boeken
//   GET  /api/boeking?token=     details voor de beheerpagina (alleen met het token)
//   POST /api/annuleer           annuleren (gast, of eigenaar met beheersleutel)
//   POST /api/verzet             verzetten (gast, of eigenaar met beheersleutel)
//   GET  /api/status             werkt de koppeling? (geen persoonsgegevens)
// Er komt nooit een lijst met persoonsgegevens uit een publieke route; een
// boeking is alleen op te vragen met zijn eigen token (64 tekens).
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { lokaalNaarUtc } from "./slots";
import { instellingen, plekTekst, soortOpSlug, zichtbareSoorten } from "./instellingen";
import { PAGINA_HTML } from "./pagina_html";

const http = httpRouter();

const JSON_KOP = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  // Het antwoord kan een persoonlijke beheerlink bevatten: nergens bewaren.
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
};
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};
const EMAIL_RE = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;
const DATUM_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TZ = () => instellingen.tijdzone;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: JSON_KOP });
}
const fout = (status: number, tekst: string, code = "fout") => json({ ok: false, code, fout: tekst }, status);

/** Vergelijkt de beheersleutel zonder dat de tijd iets verraadt. */
function isEigenaar(sleutel: unknown): boolean {
  const s = process.env.BEHEER_SLEUTEL;
  if (!s || typeof sleutel !== "string" || sleutel.length !== s.length) return false;
  let verschil = 0;
  for (let i = 0; i < s.length; i++) verschil |= s.charCodeAt(i) ^ sleutel.charCodeAt(i);
  return verschil === 0;
}

function ipHash(request: Request): string | undefined {
  const xff = request.headers.get("x-forwarded-for");
  const ip = xff ? xff.split(",")[0].trim() : (request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip"));
  if (!ip) return undefined;
  let h = 0x811c9dc5; // alleen een korte sleutel voor de rem per adres, geen beveiliging
  for (let i = 0; i < ip.length; i++) { h ^= ip.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

function geldigeTijdzone(tz: unknown): string {
  if (typeof tz !== "string" || !tz) return TZ();
  try { new Intl.DateTimeFormat("nl-NL", { timeZone: tz }); return tz; } catch { return TZ(); }
}

async function lichaam(request: Request): Promise<Record<string, any> | null> {
  try {
    const t = await request.text();
    if (t.length > 50_000) return null;
    return JSON.parse(t);
  } catch { return null; }
}

const tekst = (x: unknown, max: number) => (typeof x === "string" ? x : "").trim().slice(0, max);
// De ingevoerde sleutel van de eigenaar, of null als dit de gast is.
const eigenaarVeld = (b: Record<string, any>) => (b.eigenaar !== undefined && b.eigenaar !== null ? b.eigenaar : null);

// ─── De pagina ──────────────────────────────────────────────────────────────

const pagina = httpAction(async (_ctx, request) => {
  const pad = new URL(request.url).pathname;
  // Bestanden die browsers vanzelf opvragen (favicon.ico, robots.txt) hebben we niet.
  if (/\.[a-z0-9]{2,4}$/i.test(pad) && pad !== "/index.html") {
    if (pad === "/robots.txt") return new Response("User-agent: *\nDisallow: /\n", { headers: { "Content-Type": "text/plain" } });
    return new Response("Niet gevonden", { status: 404 });
  }
  return new Response(PAGINA_HTML, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
http.route({ path: "/", method: "GET", handler: pagina });
http.route({ pathPrefix: "/", method: "GET", handler: pagina });

// ─── API ────────────────────────────────────────────────────────────────────

for (const path of ["/api/boek", "/api/annuleer", "/api/verzet"]) {
  http.route({ path, method: "OPTIONS", handler: httpAction(async () => new Response(null, { status: 204, headers: CORS })) });
}

http.route({
  path: "/api/pagina", method: "GET",
  handler: httpAction(async () => {
    const u = instellingen.uiterlijk;
    return json({
      ok: true,
      eigenaar: instellingen.eigenaar.naam, bedrijf: instellingen.bedrijf, contact: instellingen.eigenaar.email,
      tijdzone: TZ(), titel: u.titel, intro: u.intro, logo_url: u.logo_url, website: u.website,
      kleuren: { accent: u.kleur_accent, tekst: u.kleur_tekst, achtergrond: u.kleur_achtergrond },
    });
  }),
});

http.route({
  path: "/api/soorten", method: "GET",
  handler: httpAction(async () => json({
    ok: true,
    soorten: zichtbareSoorten().map((s) => ({ slug: s.slug, naam: s.naam, duur_min: s.duur_min, beschrijving: s.beschrijving, plek: plekTekst(s) })),
  })),
});

http.route({
  path: "/api/soort", method: "GET",
  handler: httpAction(async (_ctx, request) => {
    const s = soortOpSlug(tekst(new URL(request.url).searchParams.get("slug"), 80));
    if (!s || s.uit) return fout(404, "Deze boekingslink bestaat niet (meer).", "onbekend");
    return json({
      ok: true,
      soort: {
        slug: s.slug, naam: s.naam, duur_min: s.duur_min, beschrijving: s.beschrijving, plek: plekTekst(s),
        vragen: s.vragen, horizon_dagen: s.horizon_dagen, min_aankondiging_uur: s.min_aankondiging_uur, tz: TZ(),
      },
    });
  }),
});

http.route({
  path: "/api/tijden", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const p = new URL(request.url).searchParams;
    const slug = tekst(p.get("slug"), 80);
    const mVan = DATUM_RE.exec(p.get("van") ?? ""), mTot = DATUM_RE.exec(p.get("tot") ?? "");
    if (!slug || !mVan || !mTot) return fout(400, "slug, van en tot (JJJJ-MM-DD) zijn verplicht");
    const van = lokaalNaarUtc(+mVan[1], +mVan[2], +mVan[3], 0, 0, TZ());
    const tot = lokaalNaarUtc(+mTot[1], +mTot[2], +mTot[3], 23, 59, TZ());
    if (tot < van || tot - van > 70 * 86_400_000) return fout(400, "bereik te groot (max 70 dagen)");
    try {
      const tijden: number[] = await ctx.runAction(internal.afspraak.slots, { slug, van, tot });
      return json({ ok: true, tijden, nu: Date.now(), tz: TZ() });
    } catch (e: any) {
      console.error("tijden mislukt", e?.message);
      return json({ ok: false, code: "agenda", fout: "De agenda is even niet bereikbaar. Probeer het zo nog eens." });
    }
  }),
});

http.route({
  path: "/api/boek", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const b = await lichaam(request);
    if (!b) return fout(400, "Ongeldige aanvraag.");
    if (tekst(b.website, 100)) return json({ ok: true, token: "ok" }); // lokveld voor bots: doe alsof
    const slug = tekst(b.slug, 80), naam = tekst(b.naam, 120), email = tekst(b.email, 200).toLowerCase();
    const start = Number(b.start);
    if (!slug || !naam || !email) return fout(400, "Naam en e-mail zijn verplicht.", "onvolledig");
    if (!EMAIL_RE.test(email)) return fout(400, "Dat e-mailadres klopt niet helemaal.", "email");
    if (!Number.isFinite(start) || start < Date.now()) return fout(400, "Kies een moment in de toekomst.", "tijd");
    const antwoorden = Array.isArray(b.antwoorden)
      ? b.antwoorden.slice(0, 20).map((x: any) => ({
          id: tekst(x?.id, 40),
          antwoord: Array.isArray(x?.antwoord) ? x.antwoord.map((y: unknown) => tekst(y, 200)).filter(Boolean).join(", ") : tekst(x?.antwoord, 20000),
        }))
      : [];
    const r = await ctx.runAction(internal.afspraak.boek, {
      slug, start, naam, email, antwoorden, tijdzone: geldigeTijdzone(b.tijdzone), ip_hash: ipHash(request),
    });
    return json(r, r.ok ? 200 : r.code === "bezet" ? 409 : r.code === "agenda" ? 200 : 400);
  }),
});

http.route({
  path: "/api/boeking", method: "GET",
  handler: httpAction(async (ctx, request) => {
    const p = new URL(request.url).searchParams;
    const token = tekst(p.get("token"), 64);
    if (!TOKEN_RE.test(token)) return fout(404, "Deze link klopt niet.", "onbekend");
    const sleutel = p.get("eigenaar");
    if (sleutel !== null && !isEigenaar(sleutel)) return fout(403, "De beheersleutel klopt niet.", "sleutel");
    const b = await ctx.runQuery(internal.afspraak.boekingOpToken, { token });
    if (!b) return fout(404, "Deze afspraak is niet gevonden.", "onbekend");
    const alsEigenaar = sleutel !== null;
    const s = soortOpSlug(b.soort_slug);
    return json({
      ok: true, als_eigenaar: alsEigenaar,
      boeking: {
        status: b.status, soort_slug: b.soort_slug, soort_naam: b.soort_naam, duur_min: b.duur_min,
        start: b.start, einde: b.einde, naam: b.naam, vergaderlink: b.vergaderlink, tijdzone: b.tijdzone_gast,
        plek: s ? plekTekst(s) : "", horizon_dagen: s?.horizon_dagen ?? 60, voorbij: b.start < Date.now(),
        ...(alsEigenaar ? { email: b.email, antwoorden: b.antwoorden, geboekt_op: b.geboekt_op, annuleer_reden: b.annuleer_reden, geannuleerd_door: b.geannuleerd_door } : {}),
      },
    });
  }),
});

http.route({
  path: "/api/annuleer", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const b = await lichaam(request);
    const token = tekst(b?.token, 64);
    if (!b || !TOKEN_RE.test(token)) return fout(400, "Deze link klopt niet.", "onbekend");
    const sleutel = eigenaarVeld(b);
    if (sleutel !== null && !isEigenaar(sleutel)) return fout(403, "De beheersleutel klopt niet.", "sleutel");
    const r = await ctx.runAction(internal.afspraak.annuleer, { token, reden: tekst(b.reden, 2000) || undefined, door: sleutel !== null ? "eigenaar" : "gast" });
    return json(r, r.ok ? 200 : 400);
  }),
});

http.route({
  path: "/api/verzet", method: "POST",
  handler: httpAction(async (ctx, request) => {
    const b = await lichaam(request);
    const token = tekst(b?.token, 64);
    const start = Number(b?.start);
    if (!b || !TOKEN_RE.test(token)) return fout(400, "Deze link klopt niet.", "onbekend");
    if (!Number.isFinite(start) || start < Date.now()) return fout(400, "Kies een moment in de toekomst.", "tijd");
    const sleutel = eigenaarVeld(b);
    if (sleutel !== null && !isEigenaar(sleutel)) return fout(403, "De beheersleutel klopt niet.", "sleutel");
    const r = await ctx.runAction(internal.afspraak.verzet, { token, start, tijdzone: geldigeTijdzone(b.tijdzone), door: sleutel !== null ? "eigenaar" : "gast" });
    return json(r, r.ok ? 200 : r.code === "bezet" ? 409 : 400);
  }),
});

http.route({
  path: "/api/status", method: "GET",
  handler: httpAction(async (ctx) => {
    const k = await ctx.runQuery(internal.koppeling.lees, { aanbieder: instellingen.agenda.aanbieder });
    const goed = !!k?.laatst_gelukt && (!k.laatste_fout_op || k.laatst_gelukt > k.laatste_fout_op);
    return json({
      ok: true, aanbieder: instellingen.agenda.aanbieder, mail_via: instellingen.mail.via,
      koppeling: k ? (goed ? "werkt" : "fout") : "nog niet gebruikt",
      laatst_gelukt: k?.laatst_gelukt ?? null,
      beheersleutel_gezet: !!process.env.BEHEER_SLEUTEL,
    });
  }),
});

export default http;
