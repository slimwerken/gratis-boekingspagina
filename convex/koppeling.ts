// De koppeling met Google of Microsoft: een geldig toegangsbewijs ophalen.
//
// Sleutels in de Convex-omgeving (gezet door `npm run koppel`, zie INSTALLEER-MIJ.md):
//   Google:    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN
//   Microsoft: MICROSOFT_CLIENT_ID, MICROSOFT_REFRESH_TOKEN,
//              optioneel MICROSOFT_TENANT (standaard "common") en MICROSOFT_CLIENT_SECRET
//
// Microsoft geeft bij elk vernieuwen een nieuwe vernieuw-sleutel terug. Die
// bewaren we in de tabel `koppeling`, anders verloopt de koppeling na 90 dagen.
import { internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { instellingen } from "./instellingen";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/gmail.send",
];
export const MICROSOFT_SCOPES = ["offline_access", "User.Read", "Calendars.ReadWrite", "Mail.Send"];

type Ctx = { runQuery: any; runMutation: any };

export const lees = internalQuery({
  args: { aanbieder: v.string() },
  handler: async (ctx, { aanbieder }) =>
    ctx.db.query("koppeling").withIndex("by_aanbieder", (q) => q.eq("aanbieder", aanbieder)).unique(),
});

export const schrijf = internalMutation({
  args: {
    aanbieder: v.string(),
    access_token: v.optional(v.string()), verloopt_op: v.optional(v.number()),
    refresh_token: v.optional(v.string()), env_vingerafdruk: v.optional(v.string()),
    fout: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const oud = await ctx.db.query("koppeling").withIndex("by_aanbieder", (q) => q.eq("aanbieder", a.aanbieder)).unique();
    const nu = Date.now();
    const patch: Record<string, unknown> = a.fout
      ? { laatste_fout: a.fout.slice(0, 500), laatste_fout_op: nu }
      : {
          access_token: a.access_token, verloopt_op: a.verloopt_op, laatst_gelukt: nu, laatste_fout: undefined,
          ...(a.refresh_token ? { refresh_token: a.refresh_token } : {}),
          ...(a.env_vingerafdruk ? { env_vingerafdruk: a.env_vingerafdruk } : {}),
        };
    if (oud) await ctx.db.patch(oud._id, patch);
    else await ctx.db.insert("koppeling", { aanbieder: a.aanbieder, ...patch });
  },
});

/** Korte vingerafdruk (geen beveiliging, alleen "is dit dezelfde sleutel?"). */
function vingerafdruk(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16);
}

function moet(naam: string): string {
  const w = process.env[naam];
  if (!w) throw new Error(`${naam} ontbreekt in de Convex-omgeving. Koppel je agenda opnieuw (npm run koppel).`);
  return w;
}

/** Een geldig toegangsbewijs voor de gekozen aanbieder. */
export async function toegang(ctx: Ctx): Promise<string> {
  const aanbieder = instellingen.agenda.aanbieder;
  const rij = await ctx.runQuery(internal.koppeling.lees, { aanbieder });
  if (rij?.access_token && rij.verloopt_op && rij.verloopt_op > Date.now() + 60_000) return rij.access_token;

  const envRefresh = moet(aanbieder === "google" ? "GOOGLE_REFRESH_TOKEN" : "MICROSOFT_REFRESH_TOKEN");
  const afdruk = vingerafdruk(envRefresh);
  // De bewaarde (nieuwere) sleutel, tenzij er intussen opnieuw gekoppeld is.
  const refresh = rij?.refresh_token && rij.env_vingerafdruk === afdruk ? rij.refresh_token : envRefresh;

  let res: Response;
  if (aanbieder === "google") {
    res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: moet("GOOGLE_CLIENT_ID"), client_secret: moet("GOOGLE_CLIENT_SECRET"),
        refresh_token: refresh, grant_type: "refresh_token",
      }),
    });
  } else {
    const tenant = process.env.MICROSOFT_TENANT || "common";
    const velden: Record<string, string> = {
      client_id: moet("MICROSOFT_CLIENT_ID"), refresh_token: refresh, grant_type: "refresh_token",
      scope: MICROSOFT_SCOPES.join(" "),
    };
    if (process.env.MICROSOFT_CLIENT_SECRET) velden.client_secret = process.env.MICROSOFT_CLIENT_SECRET;
    res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(velden),
    });
  }
  const d: any = await res.json().catch(() => ({}));
  if (!d.access_token) {
    const fout = `${aanbieder} gaf geen toegang: ${d.error ?? res.status} ${String(d.error_description ?? "").slice(0, 200)}`;
    await ctx.runMutation(internal.koppeling.schrijf, { aanbieder, fout });
    throw new Error(fout);
  }
  await ctx.runMutation(internal.koppeling.schrijf, {
    aanbieder, access_token: d.access_token,
    verloopt_op: Date.now() + (Number(d.expires_in) || 3600) * 1000,
    refresh_token: d.refresh_token, env_vingerafdruk: afdruk,
  });
  return d.access_token as string;
}
