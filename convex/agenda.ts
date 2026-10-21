// Je agenda: vrij/bezet lezen en afspraken aanmaken, verzetten en afzeggen.
//
// Twee aanbieders achter dezelfde vijf functies. Welke het is staat in
// instellingen.ts (agenda.aanbieder). Google: Calendar API, met Google Meet.
// Microsoft: Graph API (Outlook.com en Microsoft 365), met Teams waar dat kan.
// De gast staat als deelnemer op het item, dus Google of Outlook stuurt zelf de
// uitnodiging, en bij verzetten en afzeggen ook de wijziging.
import type { Blok } from "./slots";
import { instellingen } from "./instellingen";
import { toegang } from "./koppeling";

type Ctx = { runQuery: any; runMutation: any };

export type NieuwItem = {
  titel: string;
  beschrijving: string;
  start: number;
  einde: number;
  gast: { naam: string; email: string };
  token: string;
  locatie?: string;   // een vaste plek; leeg = online vergadering (als die aanstaat)
};
export type AgendaItem = { id: string; weg: boolean; start?: number; einde?: number };

const A = () => instellingen.agenda;
const isGoogle = () => A().aanbieder === "google";

async function aanroep(ctx: Ctx, url: string, init: RequestInit & { query?: Record<string, string> } = {}): Promise<any> {
  const token = await toegang(ctx);
  const u = new URL(url);
  for (const [k, w] of Object.entries(init.query ?? {})) u.searchParams.set(k, w);
  const { query: _q, ...rest } = init;
  const res = await fetch(u.toString(), {
    ...rest,
    headers: {
      Authorization: `Bearer ${token}`, "Content-Type": "application/json",
      ...(isGoogle() ? {} : { Prefer: 'outlook.timezone="UTC"' }),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 204 || res.status === 202) return null;
  const tekst = await res.text();
  let data: any = null;
  try { data = tekst ? JSON.parse(tekst) : null; } catch { data = { raw: tekst.slice(0, 300) }; }
  if (!res.ok) {
    const fout: any = new Error(`${init.method ?? "GET"} ${u.pathname}: HTTP ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
    fout.status = res.status;
    throw fout;
  }
  return data;
}

// ─── Google ─────────────────────────────────────────────────────────────────

const GCAL = "https://www.googleapis.com/calendar/v3";
const gAgenda = () => `${GCAL}/calendars/${encodeURIComponent(A().afspraak_in || "primary")}/events`;

function gTijd(ms: number) { return { dateTime: new Date(ms).toISOString(), timeZone: instellingen.tijdzone }; }
function gLees(e: any): AgendaItem {
  return {
    id: e.id, weg: e.status === "cancelled",
    start: e.start?.dateTime ? Date.parse(e.start.dateTime) : undefined,
    einde: e.end?.dateTime ? Date.parse(e.end.dateTime) : undefined,
  };
}

// ─── Microsoft ──────────────────────────────────────────────────────────────

const GRAPH = "https://graph.microsoft.com/v1.0/me";
function mAgenda(id: string = A().afspraak_in): string {
  return !id || id === "primary" ? `${GRAPH}/calendar` : `${GRAPH}/calendars/${encodeURIComponent(id)}`;
}
// Graph geeft tijden zonder "Z" terug; met de Prefer-header zijn ze in UTC.
function mMs(t?: { dateTime?: string }): number | undefined {
  if (!t?.dateTime) return undefined;
  return Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(t.dateTime) ? t.dateTime : t.dateTime + "Z");
}
function mTijd(ms: number) { return { dateTime: new Date(ms).toISOString().replace("Z", ""), timeZone: "UTC" }; }
function mLees(e: any): AgendaItem {
  return { id: e.id, weg: !!e.isCancelled, start: mMs(e.start), einde: mMs(e.end) };
}

// ─── De vijf functies ───────────────────────────────────────────────────────

/** Bezet-blokken uit alle agenda's die meetellen, tussen `van` en `tot` (ms UTC). */
export async function vrijBezet(ctx: Ctx, van: number, tot: number): Promise<Blok[]> {
  const agendas = [A().afspraak_in || "primary", ...A().bezet_uit.filter((x) => x && x !== A().afspraak_in)];
  const uit: Blok[] = [];
  if (isGoogle()) {
    const d = await aanroep(ctx, `${GCAL}/freeBusy`, {
      method: "POST",
      body: JSON.stringify({
        timeMin: new Date(van).toISOString(), timeMax: new Date(tot).toISOString(),
        items: agendas.map((id) => ({ id })),
      }),
    });
    for (const [id, cal] of Object.entries((d?.calendars ?? {}) as Record<string, any>)) {
      if (cal.errors?.length) console.warn(`vrij/bezet ${id}:`, JSON.stringify(cal.errors).slice(0, 200));
      for (const b of cal.busy ?? []) uit.push({ start: Date.parse(b.start), einde: Date.parse(b.end) });
    }
  } else {
    for (const id of agendas) {
      let url: string | undefined = `${mAgenda(id)}/calendarView`;
      let query: Record<string, string> | undefined = {
        startDateTime: new Date(van).toISOString(), endDateTime: new Date(tot).toISOString(),
        $select: "start,end,showAs,isCancelled", $top: "200",
      };
      while (url) {
        const d: any = await aanroep(ctx, url, { query });
        for (const e of d?.value ?? []) {
          // "free" en "workingElsewhere" houden je niet bezig; al het andere wel.
          if (e.isCancelled || e.showAs === "free" || e.showAs === "workingElsewhere") continue;
          const s = mMs(e.start), t = mMs(e.end);
          if (s !== undefined && t !== undefined) uit.push({ start: s, einde: t });
        }
        url = d?.["@odata.nextLink"]; query = undefined;
      }
    }
  }
  return uit.sort((a, b) => a.start - b.start);
}

/** Zet de afspraak in je agenda, met de gast als deelnemer en (als het kan) een online vergadering. */
export async function maakItem(ctx: Ctx, e: NieuwItem): Promise<{ id: string; vergaderlink?: string }> {
  const online = A().online_vergadering && !e.locatie;
  if (isGoogle()) {
    const d = await aanroep(ctx, gAgenda(), {
      method: "POST",
      query: { conferenceDataVersion: "1", sendUpdates: "all" },
      body: JSON.stringify({
        summary: e.titel, description: e.beschrijving,
        ...(e.locatie ? { location: e.locatie } : {}),
        start: gTijd(e.start), end: gTijd(e.einde),
        attendees: [{ email: e.gast.email, displayName: e.gast.naam }],
        ...(online ? { conferenceData: { createRequest: { requestId: e.token.slice(0, 32), conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
        extendedProperties: { private: { boeking_token: e.token } },
        reminders: { useDefault: true },
        guestsCanModify: false,
      }),
    });
    const link = d?.hangoutLink ?? d?.conferenceData?.entryPoints?.find((p: any) => p.entryPointType === "video")?.uri;
    return { id: d.id as string, vergaderlink: link };
  }
  const basis = {
    subject: e.titel,
    body: { contentType: "text", content: e.beschrijving },
    start: mTijd(e.start), end: mTijd(e.einde),
    attendees: [{ emailAddress: { address: e.gast.email, name: e.gast.naam }, type: "required" }],
    ...(e.locatie ? { location: { displayName: e.locatie } } : {}),
    allowNewTimeProposals: false,
    transactionId: e.token.slice(0, 40),
  };
  // Teams kan alleen met een Microsoft 365-werkaccount. Een persoonlijk
  // Outlook.com-account weigert dat; dan komt de afspraak er zonder online
  // vergadering in (zet dan bij de soort een `locatie`, bijv. "Ik bel je").
  const pogingen: Record<string, unknown>[] = online
    ? [{ isOnlineMeeting: true, onlineMeetingProvider: "teamsForBusiness" }, {}]
    : [{}];
  let laatste: any;
  for (const extra of pogingen) {
    try {
      const d = await aanroep(ctx, `${mAgenda()}/events`, { method: "POST", body: JSON.stringify({ ...basis, ...extra }) });
      return { id: d.id as string, vergaderlink: d?.onlineMeeting?.joinUrl ?? d?.onlineMeetingUrl ?? undefined };
    } catch (err: any) {
      laatste = err;
      if (err?.status !== 400) throw err; // alleen bij "dit soort vergadering kan niet" de volgende proberen
    }
  }
  throw laatste;
}

/** Verzetten: alleen de tijden (en de beschrijving) wijzigen, de vergaderlink blijft. */
export async function verplaatsItem(ctx: Ctx, id: string, start: number, einde: number, beschrijving?: string): Promise<void> {
  if (isGoogle()) {
    await aanroep(ctx, `${gAgenda()}/${encodeURIComponent(id)}`, {
      method: "PATCH", query: { sendUpdates: "all" },
      body: JSON.stringify({ start: gTijd(start), end: gTijd(einde), ...(beschrijving !== undefined ? { description: beschrijving } : {}) }),
    });
    return;
  }
  await aanroep(ctx, `${GRAPH}/events/${encodeURIComponent(id)}`, {
    method: "PATCH",
    body: JSON.stringify({ start: mTijd(start), end: mTijd(einde), ...(beschrijving !== undefined ? { body: { contentType: "text", content: beschrijving } } : {}) }),
  });
}

/** Afzeggen; Google of Outlook mailt de gast de afzegging. Al weg telt als gelukt. */
export async function verwijderItem(ctx: Ctx, id: string, reden?: string): Promise<void> {
  try {
    if (isGoogle()) {
      await aanroep(ctx, `${gAgenda()}/${encodeURIComponent(id)}`, { method: "DELETE", query: { sendUpdates: "all" } });
    } else {
      await aanroep(ctx, `${GRAPH}/events/${encodeURIComponent(id)}/cancel`, {
        method: "POST", body: JSON.stringify({ comment: reden ?? "" }),
      });
    }
  } catch (e: any) {
    if (e?.status === 404 || e?.status === 410) return;
    throw e;
  }
}

/** Een item ophalen; null als hij weg is. Voor de controle "heeft de eigenaar iets versleept of weggegooid?". */
export async function haalItem(ctx: Ctx, id: string): Promise<AgendaItem | null> {
  try {
    if (isGoogle()) return gLees(await aanroep(ctx, `${gAgenda()}/${encodeURIComponent(id)}`));
    return mLees(await aanroep(ctx, `${GRAPH}/events/${encodeURIComponent(id)}`, { query: { $select: "start,end,isCancelled" } }));
  } catch (err: any) {
    if (err?.status === 404 || err?.status === 410) return null;
    throw err;
  }
}
