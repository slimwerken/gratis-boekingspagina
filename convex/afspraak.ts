// Boeken, annuleren, verzetten en herinneren. Alles intern; de publieke
// ingang zijn de routes in http.ts.
//
// De volgorde bij boeken is de kern:
//   1. het tijdstip opnieuw uitrekenen met vers vrij/bezet (is het er nog?)
//   2. reserveren in de database (transactioneel: dit voorkomt dubbel boeken)
//   3. het agenda-item aanmaken (met online vergadering; de agenda stuurt de uitnodiging)
//   4. bevestigen, mailen, jou melden
// Mislukt 3, dan gaat de reservering weer weg. Er bestaat nooit een actieve
// boeking zonder agenda-item.
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { berekenSlots, boekingenAlsBezet, datumSleutel, raaktBezet, type Blok } from "./slots";
import { instellingen, soortOpSlug, type VolleSoort } from "./instellingen";
import { haalItem, maakItem, verplaatsItem, verwijderItem, vrijBezet } from "./agenda";
import {
  agendaBeschrijving, annuleringMail, bevestigingMail, herinneringMail, meldMij, meldingTekst,
  stuurMail, verzetMail, voornaam, type MailBoeking,
} from "./mail";

const MIN = 60_000, UUR = 3_600_000, DAG = 86_400_000;
const CACHE_GELDIG_MS = 60_000;
const MAX_PER_EMAIL_24U = 3;
const MAX_PER_IP_10MIN = 10; // een kantoor achter een adres mag best een paar keer boeken; een bot niet honderd keer
const TZ = () => instellingen.tijdzone;
const naamEigenaar = () => voornaam(instellingen.eigenaar.naam);

// ─── Queries ────────────────────────────────────────────────────────────────

export const boekingOpToken = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }) =>
    ctx.db.query("afspraken").withIndex("by_token", (q) => q.eq("token", token)).unique(),
});

/** Boekingen die een tijdstip kunnen blokkeren: actief of nog in aanmaak. */
export const blokkerendeBoekingen = internalQuery({
  args: { van: v.number(), tot: v.number() },
  handler: async (ctx, { van, tot }) => {
    const uit: Doc<"afspraken">[] = [];
    for (const status of ["actief", "in_aanmaak"] as const) {
      uit.push(...await ctx.db.query("afspraken")
        .withIndex("by_status_start", (q) => q.eq("status", status).gte("start", van - DAG).lte("start", tot + DAG))
        .collect());
    }
    return uit;
  },
});

export const cacheLees = internalQuery({
  args: {},
  handler: async (ctx) =>
    ctx.db.query("bezet_cache").withIndex("by_sleutel", (q) => q.eq("sleutel", "bezet")).unique(),
});

/** Actieve, toekomstige boekingen met een agenda-item: wat de agenda-controle naloopt. */
export const actieveMetItem = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rijen = await ctx.db.query("afspraken")
      .withIndex("by_status_start", (q) => q.eq("status", "actief").gte("start", Date.now() - UUR))
      .collect();
    return rijen.filter((b) => !!b.agenda_item_id);
  },
});

export const herinneringKandidaten = internalQuery({
  args: { uren: v.number() },
  handler: async (ctx, { uren }) => {
    const nu = Date.now();
    const rijen = await ctx.db.query("afspraken")
      .withIndex("by_status_start", (q) => q.eq("status", "actief").gte("start", nu).lte("start", nu + uren * UUR))
      .collect();
    return rijen.filter((b) => !b.herinnering_verzonden.includes(uren));
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

function maakToken(): string {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, "");
}

export const reserveer = internalMutation({
  args: {
    soort_slug: v.string(), soort_naam: v.string(), duur_min: v.number(),
    start: v.number(), einde: v.number(), buffer_voor_min: v.number(), buffer_na_min: v.number(),
    naam: v.string(), email: v.string(), antwoorden: v.array(v.object({ vraag: v.string(), antwoord: v.string() })),
    tijdzone_gast: v.string(), ip_hash: v.optional(v.string()), max_per_dag: v.optional(v.number()),
  },
  handler: async (ctx, { max_per_dag, ...a }) => {
    const nu = Date.now();
    const buren: Doc<"afspraken">[] = [];
    for (const status of ["actief", "in_aanmaak"] as const) {
      buren.push(...await ctx.db.query("afspraken")
        .withIndex("by_status_start", (q) => q.eq("status", status).gte("start", a.start - DAG).lte("start", a.einde + DAG))
        .collect());
    }
    // Dubbel boeken: raakt iets actiefs of in aanmaak dit tijdstip (met buffers)?
    if (raaktBezet(a.start, a.einde, a.buffer_voor_min, a.buffer_na_min, boekingenAlsBezet(buren))) {
      return { ok: false as const, code: "bezet", fout: "Dit moment is net weg. Kies een ander tijdstip." };
    }
    // Maximum per dag, hier opnieuw: twee mensen die tegelijk de laatste plek pakken.
    if (max_per_dag !== undefined) {
      const dag = datumSleutel(a.start, TZ());
      if (buren.filter((b) => datumSleutel(b.start, TZ()) === dag).length >= max_per_dag) {
        return { ok: false as const, code: "bezet", fout: "Deze dag is net vol geraakt. Kies een andere dag." };
      }
    }
    const perEmail = (await ctx.db.query("afspraken").withIndex("by_email", (q) => q.eq("email", a.email)).collect())
      .filter((b) => b.geboekt_op > nu - DAG && b.status !== "geannuleerd");
    if (perEmail.length >= MAX_PER_EMAIL_24U) {
      return { ok: false as const, code: "te_veel", fout: `Er staan al drie afspraken op dit e-mailadres. Mail ${instellingen.eigenaar.email} even direct.` };
    }
    if (a.ip_hash) {
      const perIp = await ctx.db.query("afspraken")
        .withIndex("by_ip", (q) => q.eq("ip_hash", a.ip_hash).gt("geboekt_op", nu - 10 * MIN)).collect();
      if (perIp.length >= MAX_PER_IP_10MIN) {
        return { ok: false as const, code: "te_veel", fout: "Even rustig aan. Probeer het over tien minuten nog eens." };
      }
    }
    const token = maakToken();
    const id = await ctx.db.insert("afspraken", { ...a, status: "in_aanmaak", token, geboekt_op: nu, herinnering_verzonden: [] });
    return { ok: true as const, id, token };
  },
});

export const bevestig = internalMutation({
  args: { id: v.id("afspraken"), agenda_item_id: v.string(), vergaderlink: v.optional(v.string()) },
  handler: async (ctx, { id, agenda_item_id, vergaderlink }) => {
    await ctx.db.patch(id, { status: "actief", agenda_item_id, vergaderlink });
  },
});

export const verwijderReservering = internalMutation({
  args: { id: v.id("afspraken") },
  handler: async (ctx, { id }) => { await ctx.db.delete(id); },
});

export const zetGeannuleerd = internalMutation({
  args: { id: v.id("afspraken"), reden: v.optional(v.string()), door: v.string() },
  handler: async (ctx, { id, reden, door }) => {
    await ctx.db.patch(id, { status: "geannuleerd", geannuleerd_op: Date.now(), annuleer_reden: reden, geannuleerd_door: door });
  },
});

export const zetVerzet = internalMutation({
  args: { id: v.id("afspraken"), start: v.number(), einde: v.number(), tijdzone_gast: v.string() },
  handler: async (ctx, { id, start, einde, tijdzone_gast }) => {
    const b = await ctx.db.get(id);
    if (!b) throw new Error("boeking weg");
    await ctx.db.patch(id, { verzet_van_start: b.start, verzet_op: Date.now(), start, einde, tijdzone_gast, herinnering_verzonden: [] });
  },
});

export const markeerHerinnering = internalMutation({
  args: { id: v.id("afspraken"), uren: v.number() },
  handler: async (ctx, { id, uren }) => {
    const b = await ctx.db.get(id);
    if (b && !b.herinnering_verzonden.includes(uren)) await ctx.db.patch(id, { herinnering_verzonden: [...b.herinnering_verzonden, uren] });
  },
});

export const cacheSchrijf = internalMutation({
  args: { van: v.number(), tot: v.number(), bezet: v.array(v.object({ start: v.number(), einde: v.number() })) },
  handler: async (ctx, { van, tot, bezet }) => {
    const oud = await ctx.db.query("bezet_cache").withIndex("by_sleutel", (q) => q.eq("sleutel", "bezet")).unique();
    const rij = { sleutel: "bezet", van, tot, bezet, opgehaald_op: Date.now() };
    if (oud) await ctx.db.replace(oud._id, rij); else await ctx.db.insert("bezet_cache", rij);
  },
});

/** Reserveringen die nooit een agenda-item kregen na een uur weg. */
export const ruimOp = internalMutation({
  args: {},
  handler: async (ctx) => {
    const grens = Date.now() - UUR;
    const oud = await ctx.db.query("afspraken").withIndex("by_status_start", (q) => q.eq("status", "in_aanmaak")).collect();
    let n = 0;
    for (const b of oud) if (b.geboekt_op < grens) { await ctx.db.delete(b._id); n++; }
    return n;
  },
});

// ─── Hulpjes voor de acties ─────────────────────────────────────────────────

type Ctx = { runQuery: any; runMutation: any };

async function bezetUitAgenda(ctx: Ctx, van: number, tot: number): Promise<Blok[]> {
  const cache = await ctx.runQuery(internal.afspraak.cacheLees, {});
  const nu = Date.now();
  if (cache && cache.opgehaald_op > nu - CACHE_GELDIG_MS && cache.van <= van && cache.tot >= tot) return cache.bezet;
  const cVan = Math.min(van, nu - UUR), cTot = Math.max(tot, nu + 70 * DAG);
  const bezet = await vrijBezet(ctx, cVan, cTot);
  await ctx.runMutation(internal.afspraak.cacheSchrijf, { van: cVan, tot: cTot, bezet });
  return bezet;
}

type Negeer = { start: number; einde: number; id: Id<"afspraken"> };

async function alleBezet(ctx: Ctx, van: number, tot: number, negeer?: Negeer) {
  const agenda = await bezetUitAgenda(ctx, van, tot);
  const boekingen: Doc<"afspraken">[] = (await ctx.runQuery(internal.afspraak.blokkerendeBoekingen, { van, tot }))
    .filter((b: Doc<"afspraken">) => !negeer || b._id !== negeer.id);
  let bezet = [...agenda, ...boekingenAlsBezet(boekingen)];
  // Bij verzetten staat het oude item nog in de agenda; laat dat blok weg.
  if (negeer) bezet = bezet.filter((b) => !(b.start >= negeer.start - MIN && b.einde <= negeer.einde + MIN));
  return { bezet, boekingen };
}

function perDag(boekingen: Doc<"afspraken">[]): Record<string, number> {
  const uit: Record<string, number> = {};
  for (const b of boekingen) { const k = datumSleutel(b.start, TZ()); uit[k] = (uit[k] ?? 0) + 1; }
  return uit;
}

async function vrijeTijden(ctx: Ctx, soort: VolleSoort, van: number, tot: number, negeer?: Negeer): Promise<number[]> {
  const { bezet, boekingen } = await alleBezet(ctx, van, tot, negeer);
  return berekenSlots({ nu: Date.now(), type: soort, van, tot, bezet, boekingenPerDag: perDag(boekingen), tz: TZ() });
}

function naarMail(b: Doc<"afspraken">): MailBoeking {
  return {
    soort_slug: b.soort_slug, soort_naam: b.soort_naam, duur_min: b.duur_min, start: b.start, einde: b.einde,
    naam: b.naam, email: b.email, antwoorden: b.antwoorden, tijdzone_gast: b.tijdzone_gast,
    token: b.token, vergaderlink: b.vergaderlink, locatie: soortOpSlug(b.soort_slug)?.locatie,
  };
}

const kort = (ms: number) => new Date(ms).toLocaleString("nl-NL", { timeZone: TZ(), weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const AGENDA_FOUT = () => ({ ok: false as const, code: "agenda", fout: `De agenda is even niet bereikbaar. Probeer het zo nog eens, of mail ${instellingen.eigenaar.email}.` });

// ─── Acties ─────────────────────────────────────────────────────────────────

export const slots = internalAction({
  args: { slug: v.string(), van: v.number(), tot: v.number() },
  handler: async (ctx, { slug, van, tot }): Promise<number[]> => {
    const soort = soortOpSlug(slug);
    if (!soort || soort.uit) return [];
    return vrijeTijden(ctx, soort, van, tot);
  },
});

type Fout = { ok: false; code: string; fout: string };

export const boek = internalAction({
  args: {
    slug: v.string(), start: v.number(), naam: v.string(), email: v.string(),
    antwoorden: v.array(v.object({ id: v.string(), antwoord: v.string() })),
    tijdzone: v.string(), ip_hash: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<Fout | { ok: true; token: string; start: number; einde: number; vergaderlink?: string; soort_naam: string; duur_min: number }> => {
    const soort = soortOpSlug(a.slug);
    if (!soort || soort.uit) return { ok: false, code: "onbekend", fout: "Deze boekingslink bestaat niet meer." };

    const antwoorden: { vraag: string; antwoord: string }[] = [];
    for (const vraag of soort.vragen) {
      const gegeven = (a.antwoorden.find((x) => x.id === vraag.id)?.antwoord ?? "").trim().slice(0, 20000);
      if (vraag.verplicht && !gegeven) return { ok: false, code: "onvolledig", fout: `Vul nog even in: ${vraag.label}` };
      antwoorden.push({ vraag: vraag.label, antwoord: gegeven });
    }

    const einde = a.start + soort.duur_min * MIN;
    let vrij: number[];
    try { vrij = await vrijeTijden(ctx, soort, a.start - DAG, a.start + DAG); }
    catch (e: any) { console.error("vrij/bezet mislukt", e?.message); return AGENDA_FOUT(); }
    if (!vrij.includes(a.start)) return { ok: false, code: "bezet", fout: "Dit moment is net weg. Kies een ander tijdstip." };

    const res = await ctx.runMutation(internal.afspraak.reserveer, {
      soort_slug: soort.slug, soort_naam: soort.naam, duur_min: soort.duur_min,
      start: a.start, einde, buffer_voor_min: soort.buffer_voor_min, buffer_na_min: soort.buffer_na_min,
      naam: a.naam, email: a.email, antwoorden, tijdzone_gast: a.tijdzone, ip_hash: a.ip_hash,
      max_per_dag: soort.max_per_dag,
    });
    if (!res.ok) return res;

    const boeking: MailBoeking = {
      soort_slug: soort.slug, soort_naam: soort.naam, duur_min: soort.duur_min, start: a.start, einde,
      naam: a.naam, email: a.email, antwoorden, tijdzone_gast: a.tijdzone, token: res.token, locatie: soort.locatie,
    };
    let item: { id: string; vergaderlink?: string };
    try {
      item = await maakItem(ctx, {
        titel: `${soort.naam} met ${a.naam}`,
        beschrijving: agendaBeschrijving(boeking, soort.beschrijving),
        start: a.start, einde, gast: { naam: a.naam, email: a.email }, token: res.token, locatie: soort.locatie,
      });
    } catch (e: any) {
      await ctx.runMutation(internal.afspraak.verwijderReservering, { id: res.id });
      console.error("agenda-item mislukt", e?.message);
      await meldMij(ctx, "Boekingspagina: afspraak kon niet in je agenda", `${a.naam} <${a.email}> wilde ${soort.naam} op ${kort(a.start)} boeken, maar je agenda gaf een fout:\n\n${String(e?.message).slice(0, 500)}`);
      return AGENDA_FOUT();
    }
    await ctx.runMutation(internal.afspraak.bevestig, { id: res.id, agenda_item_id: item.id, vergaderlink: item.vergaderlink });
    boeking.vergaderlink = item.vergaderlink;

    const mail = bevestigingMail(boeking);
    const verzonden = await stuurMail(ctx, a.email, mail.onderwerp, mail.html);
    if (!verzonden.ok) console.warn("bevestigingsmail mislukt", verzonden.fout);
    await meldMij(ctx, `Nieuwe afspraak: ${a.naam}, ${soort.naam}, ${kort(a.start)}`, meldingTekst(boeking, "Er is een afspraak geboekt via je boekingspagina."));

    return { ok: true, token: res.token, start: a.start, einde, vergaderlink: item.vergaderlink, soort_naam: soort.naam, duur_min: soort.duur_min };
  },
});

export const annuleer = internalAction({
  args: {
    token: v.string(), reden: v.optional(v.string()), door: v.union(v.literal("gast"), v.literal("eigenaar")),
    // uitAgenda: de eigenaar gooide het item al weg in zijn agenda. Dan niets meer te verwijderen.
    uitAgenda: v.optional(v.boolean()),
  },
  handler: async (ctx, { token, reden, door, uitAgenda }): Promise<Fout | { ok: true; al?: boolean; mail?: boolean }> => {
    const b = await ctx.runQuery(internal.afspraak.boekingOpToken, { token });
    if (!b) return { ok: false, code: "onbekend", fout: "Deze afspraak is niet gevonden." };
    if (b.status === "geannuleerd") return { ok: true, al: true };
    if (b.status !== "actief") return { ok: false, code: "status", fout: "Deze afspraak is nog niet afgerond." };
    if (b.start < Date.now()) return { ok: false, code: "voorbij", fout: "Deze afspraak is al geweest." };
    const r = reden?.trim() || undefined;
    if (door === "eigenaar" && !uitAgenda && !r) return { ok: false, code: "reden", fout: "Geef een reden; die tekst gaat in de mail aan je gast." };

    if (b.agenda_item_id && !uitAgenda) {
      try { await verwijderItem(ctx, b.agenda_item_id, r); }
      catch (e: any) { return { ok: false, code: "agenda", fout: `Het agenda-item verwijderen lukte niet: ${String(e?.message).slice(0, 200)}` }; }
    }
    await ctx.runMutation(internal.afspraak.zetGeannuleerd, { id: b._id, reden: r ?? (uitAgenda ? "uit de agenda verwijderd" : undefined), door });
    const mail = annuleringMail(naarMail(b), door, r);
    const verzonden = await stuurMail(ctx, b.email, mail.onderwerp, mail.html);
    if (door === "gast") {
      await meldMij(ctx, `Afspraak geannuleerd: ${b.naam}, ${b.soort_naam}`, meldingTekst(naarMail(b), `${b.naam} heeft de afspraak zelf geannuleerd.${r ? `\nReden: ${r}` : ""}`));
    } else if (uitAgenda) {
      await meldMij(ctx, `Afspraak uit je agenda: ${b.naam}, ${b.soort_naam}`, meldingTekst(naarMail(b), `Je hebt deze afspraak uit je agenda gehaald. ${b.naam} kreeg de mail "gaat niet door, ik neem contact met je op"${verzonden.ok ? "" : " (MISLUKT: " + verzonden.fout + ")"}.`));
    }
    return { ok: true, mail: verzonden.ok };
  },
});

export const verzet = internalAction({
  args: {
    token: v.string(), start: v.number(), tijdzone: v.string(),
    door: v.union(v.literal("gast"), v.literal("eigenaar")),
    // uitAgenda: de eigenaar sleepte het item al in zijn agenda. Geen controle, niets te verplaatsen.
    uitAgenda: v.optional(v.boolean()), einde: v.optional(v.number()),
  },
  handler: async (ctx, { token, start, tijdzone, door, uitAgenda, einde: eindeArg }): Promise<Fout | { ok: true; start: number; einde: number; vergaderlink?: string; mail: boolean }> => {
    const b = await ctx.runQuery(internal.afspraak.boekingOpToken, { token });
    if (!b) return { ok: false, code: "onbekend", fout: "Deze afspraak is niet gevonden." };
    if (b.status !== "actief") return { ok: false, code: "status", fout: "Deze afspraak is geannuleerd. Boek gerust een nieuwe." };
    if (b.start < Date.now()) return { ok: false, code: "voorbij", fout: "Deze afspraak is al geweest." };
    const soort = soortOpSlug(b.soort_slug);
    if (!soort) return { ok: false, code: "onbekend", fout: "Deze soort afspraak bestaat niet meer." };

    const einde = uitAgenda && eindeArg ? eindeArg : start + b.duur_min * MIN;
    if (!uitAgenda) {
      let vrij: number[];
      try { vrij = await vrijeTijden(ctx, soort, start - DAG, start + DAG, { start: b.start, einde: b.einde, id: b._id }); }
      catch (e: any) { console.error("vrij/bezet mislukt", e?.message); return AGENDA_FOUT(); }
      if (!vrij.includes(start)) return { ok: false, code: "bezet", fout: "Dit moment is net weg. Kies een ander tijdstip." };
    }

    const oudeStart = b.start;
    const nieuw: MailBoeking = { ...naarMail(b), start, einde, tijdzone_gast: tijdzone };
    if (b.agenda_item_id && !uitAgenda) {
      try { await verplaatsItem(ctx, b.agenda_item_id, start, einde, agendaBeschrijving(nieuw, soort.beschrijving)); }
      catch { return { ok: false, code: "agenda", fout: "De agenda gaf geen antwoord. Probeer het zo nog eens." }; }
    }
    await ctx.runMutation(internal.afspraak.zetVerzet, { id: b._id, start, einde, tijdzone_gast: tijdzone });
    const mail = verzetMail(nieuw, oudeStart, door);
    const verzonden = await stuurMail(ctx, b.email, mail.onderwerp, mail.html);
    const was = kort(oudeStart);
    const kop = door === "gast"
      ? `${b.naam} heeft de afspraak verzet (was ${was}).`
      : uitAgenda
        ? `Je hebt deze afspraak in je agenda verzet (was ${was}). ${b.naam} kreeg de mail met het nieuwe moment${verzonden.ok ? "" : " (MISLUKT: " + verzonden.fout + ")"}.`
        : `Je hebt de afspraak verzet (was ${was}); ${b.naam} is gemaild.`;
    await meldMij(ctx, `Afspraak verzet: ${b.naam}, ${b.soort_naam}`, meldingTekst(nieuw, kop));
    return { ok: true, start, einde, vergaderlink: b.vergaderlink, mail: verzonden.ok };
  },
});

/** Elk kwartier: herinneringen sturen en oude reserveringen opruimen. */
export const herinneringen = internalAction({
  args: {},
  handler: async (ctx): Promise<{ herinneringen: number; opgeruimd: number }> => {
    const uren = instellingen.mail.herinnering_uren_vooraf;
    let n = 0;
    if (uren > 0) {
      const kandidaten: Doc<"afspraken">[] = await ctx.runQuery(internal.afspraak.herinneringKandidaten, { uren });
      for (const b of kandidaten) {
        // Eerst markeren, dan mailen: liever een keer geen herinnering dan twee keer wel.
        await ctx.runMutation(internal.afspraak.markeerHerinnering, { id: b._id, uren });
        const mail = herinneringMail(naarMail(b));
        const r = await stuurMail(ctx, b.email, mail.onderwerp, mail.html);
        if (r.ok) n++; else console.warn("herinnering mislukt", b._id, r.fout);
      }
    }
    const opgeruimd = await ctx.runMutation(internal.afspraak.ruimOp, {});
    return { herinneringen: n, opgeruimd };
  },
});

/** Elk kwartier: wat jij in je agenda doet, volgt de boekingspagina.
 *  Weggegooid = geannuleerd (gast krijgt "gaat niet door"). Versleept = verzet
 *  (gast krijgt het nieuwe moment, herinnering schuift mee). */
export const agendaControle = internalAction({
  args: {},
  handler: async (ctx) => {
    const boekingen: Doc<"afspraken">[] = await ctx.runQuery(internal.afspraak.actieveMetItem, {});
    const nu = Date.now();
    let geannuleerd = 0, verzet = 0;
    const fouten: string[] = [];
    for (const b of boekingen) {
      try {
        const item = await haalItem(ctx, b.agenda_item_id!);
        if (!item || item.weg) {
          const r = await ctx.runAction(internal.afspraak.annuleer, { token: b.token, door: "eigenaar", uitAgenda: true });
          if (r.ok) geannuleerd++; else fouten.push(`${b.naam} annuleren: ${r.fout}`);
          continue;
        }
        if (item.start && item.einde && (Math.abs(item.start - b.start) >= MIN || Math.abs(item.einde - b.einde) >= MIN)) {
          if (item.start < nu) continue; // naar het verleden gesleept: laten staan
          const r = await ctx.runAction(internal.afspraak.verzet, {
            token: b.token, start: item.start, einde: item.einde, tijdzone: b.tijdzone_gast, door: "eigenaar", uitAgenda: true,
          });
          if (r.ok) verzet++; else fouten.push(`${b.naam} verzetten: ${r.fout}`);
        }
      } catch (e: any) {
        fouten.push(`${b.naam}: ${String(e?.message).slice(0, 120)}`);
      }
    }
    if (fouten.length) console.warn("agenda-controle:", fouten.join(" | "));
    return { nagelopen: boekingen.length, geannuleerd, verzet, fouten };
  },
});

/** Elke dag: de koppeling even gebruiken. Zo blijft hij vers (Microsoft laat
 *  een ongebruikte koppeling na 90 dagen vervallen) en zie je een probleem
 *  voordat een klant het ziet. Mislukt het, dan krijg je een mail via Resend
 *  als die er is, anders staat het in /api/status. */
export const koppelingControle = internalAction({
  args: {},
  handler: async (ctx) => {
    const nu = Date.now();
    try {
      await vrijBezet(ctx, nu, nu + DAG);
      return { ok: true };
    } catch (e: any) {
      const tekst = `Je boekingspagina kan niet meer in je agenda kijken, dus mensen zien geen vrije tijden.\n\nFout: ${String(e?.message).slice(0, 300)}\n\nOplossing: open Claude Code in de map van je boekingspagina en zeg: "Mijn boekingspagina kan niet meer in mijn agenda, koppel hem opnieuw."`;
      console.error(tekst);
      if (process.env.RESEND_API_KEY && instellingen.mail.resend_afzender) {
        await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: instellingen.mail.resend_afzender, to: [instellingen.eigenaar.email], subject: `${naamEigenaar()}, je boekingspagina is losgekoppeld`, text: tekst }),
        }).catch(() => undefined);
      }
      return { ok: false, fout: String(e?.message).slice(0, 300) };
    }
  },
});
