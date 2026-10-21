// Voor jou (of Claude) vanaf de computer, niet vanaf internet:
//   npx convex run beheer:afspraken                        de komende afspraken
//   npx convex run beheer:afspraken '{"dagen": -30}'       de afgelopen 30 dagen
//   npx convex run beheer:annuleer '{"token":"...","reden":"..."}'   afzeggen met reden
//   npx convex run beheer:test                             werkt de koppeling, wat zijn de eerste vrije tijden?
import { internalAction, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { instellingen, zichtbareSoorten } from "./instellingen";
import { paginaUrl, eigenaarUrl } from "./mail";

const DAG = 86_400_000;

export const afspraken = internalQuery({
  args: { dagen: v.optional(v.number()) },
  handler: async (ctx, { dagen }) => {
    const d = dagen ?? 60, nu = Date.now();
    const [van, tot] = d >= 0 ? [nu - DAG, nu + d * DAG] : [nu + d * DAG, nu];
    const rijen = await ctx.db.query("afspraken").withIndex("by_start", (q) => q.gte("start", van).lte("start", tot)).collect();
    const fmt = (ms: number) => new Date(ms).toLocaleString("nl-NL", { timeZone: instellingen.tijdzone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
    return rijen.sort((a, b) => a.start - b.start).map((b) => ({
      wanneer: fmt(b.start), status: b.status, soort: b.soort_naam, naam: b.naam, email: b.email,
      beheer: eigenaarUrl(b.token), token: b.token,
    }));
  },
});

export const annuleer = internalAction({
  args: { token: v.string(), reden: v.string() },
  handler: async (ctx, { token, reden }): Promise<unknown> =>
    ctx.runAction(internal.afspraak.annuleer, { token, reden, door: "eigenaar" }),
});

export const test = internalAction({
  args: {},
  handler: async (ctx): Promise<unknown> => {
    const nu = Date.now();
    const uit: Record<string, unknown> = { pagina: paginaUrl(), aanbieder: instellingen.agenda.aanbieder, mail_via: instellingen.mail.via };
    for (const s of zichtbareSoorten()) {
      const tijden: number[] = await ctx.runAction(internal.afspraak.slots, { slug: s.slug, van: nu, tot: nu + 30 * DAG });
      uit[s.slug] = { vrije_tijden_30_dagen: tijden.length, eerste: tijden[0] ? new Date(tijden[0]).toLocaleString("nl-NL", { timeZone: instellingen.tijdzone }) : null };
    }
    return uit;
  },
});
