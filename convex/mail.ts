// De mails: bevestiging, herinnering, annulering en verzetting aan je gast, en
// een korte melding aan jezelf. Versturen gaat via je eigen Gmail of Outlook
// (mail.via = "agenda"), via Resend (mail.via = "resend"), of niet (mail.via = "uit").
import { instellingen, plekTekst } from "./instellingen";
import { datumSleutel } from "./slots";
import { toegang } from "./koppeling";

type Ctx = { runQuery: any; runMutation: any };
const TZ = () => instellingen.tijdzone;

export type MailBoeking = {
  soort_slug: string;
  soort_naam: string;
  duur_min: number;
  start: number;
  einde: number;
  naam: string;
  email: string;
  antwoorden: { vraag: string; antwoord: string }[];
  tijdzone_gast: string;
  token: string;
  vergaderlink?: string;
  locatie?: string;
};

/** Het adres van de pagina. Standaard het eigen adres van je Convex-site;
 *  host je de pagina op je eigen domein, zet dan PAGINA_URL in de omgeving. */
export function paginaUrl(): string {
  return (process.env.PAGINA_URL || process.env.CONVEX_SITE_URL || "").replace(/\/+$/, "");
}
export const beheerUrl = (token: string) => `${paginaUrl()}/beheer/${token}`;
/** Jouw stand van dezelfde pagina: afzeggen met reden en verzetten. De link
 *  bevat geen geheim; de pagina vraagt een keer om je beheersleutel. */
export const eigenaarUrl = (token: string) => `${paginaUrl()}/beheer/${token}?eigenaar=1`;

export function voornaam(naam: string): string {
  return naam.trim().split(/\s+/)[0] || "daar";
}

/** "maandag 7 september" en "14:00" in de tijdzone van de gast. */
export function wanneer(ms: number, tz: string = TZ()): { dag: string; tijd: string; zone: string } {
  const maak = (zone: string) => ({
    dag: new Intl.DateTimeFormat("nl-NL", { timeZone: zone, weekday: "long", day: "numeric", month: "long" }).format(new Date(ms)),
    tijd: new Intl.DateTimeFormat("nl-NL", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(ms)),
    zone,
  });
  try { return maak(tz); } catch { return maak(TZ()); }
}

const zoneSuffix = (tz: string) => (tz === TZ() ? "" : ` (${tz.replace(/_/g, " ")})`);

export function escapeHtml(t: string): string {
  return t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const kleur = () => instellingen.uiterlijk.kleur_accent;
const alinea = (t: string) => `<p style="font-size:16px;color:#374151;line-height:1.6;margin:0 0 18px 0;">${t}</p>`;
const knop = (tekst: string, url: string) =>
  `<p style="margin:0 0 22px 0;"><a href="${url}" style="display:inline-block;background:${kleur()};color:#fff;text-decoration:none;font-weight:600;padding:12px 22px;border-radius:999px;">${tekst}</a></p>`;
const link = (tekst: string, url: string) => `<a href="${url}" style="color:${kleur()};">${tekst}</a>`;

function omhulsel(inhoud: string): string {
  const u = instellingen.uiterlijk;
  const logo = u.logo_url
    ? `<div style="text-align:center;margin:0 0 24px 0;"><img src="${escapeHtml(u.logo_url)}" alt="${escapeHtml(instellingen.bedrijf)}" style="max-height:48px;max-width:200px;border:0;" /></div>`
    : "";
  return `<!DOCTYPE html><html lang="nl"><body style="margin:0;padding:0;background:${u.kleur_achtergrond};">
  <div style="max-width:560px;margin:0 auto;padding:32px 16px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="background:#fff;border-radius:20px;padding:36px 32px;">${logo}${inhoud}</div>
    <div style="text-align:center;padding:16px 0;"><p style="font-size:12px;color:#9CA3AF;margin:0;">${escapeHtml(instellingen.bedrijf)}</p></div>
  </div></body></html>`;
}

function afsluiting(regel: string): string {
  return `<p style="font-size:16px;color:#374151;line-height:1.6;margin:0 0 6px 0;">${regel}</p>
  <p style="font-size:16px;color:${instellingen.uiterlijk.kleur_tekst};font-weight:600;margin:0;">${escapeHtml(voornaam(instellingen.eigenaar.naam))}</p>`;
}

function waarRegel(b: MailBoeking): string {
  if (b.locatie) return alinea(`Waar: ${escapeHtml(b.locatie)}`);
  if (b.vergaderlink) return knop(`${plekTekst({})} openen`, b.vergaderlink);
  return "";
}

export function bevestigingMail(b: MailBoeking) {
  const w = wanneer(b.start, b.tijdzone_gast);
  return {
    onderwerp: `${b.soort_naam} op ${w.dag} om ${w.tijd}`,
    html: omhulsel(
      alinea(`Hi ${escapeHtml(voornaam(b.naam))},`) +
      alinea(`Staat genoteerd: <strong>${escapeHtml(b.soort_naam)}</strong> op <strong>${w.dag} om ${w.tijd}</strong>${escapeHtml(zoneSuffix(w.zone))}, ${b.duur_min} minuten.`) +
      waarRegel(b) +
      alinea(`De uitnodiging voor je agenda komt in een aparte mail.`) +
      alinea(`Komt het toch niet uit? ${link("Verzetten of annuleren doe je hier", beheerUrl(b.token))}.`) +
      afsluiting("Tot dan!"),
    ),
  };
}

export function herinneringMail(b: MailBoeking, nu: number = Date.now()) {
  const w = wanneer(b.start, b.tijdzone_gast);
  let tz = b.tijdzone_gast;
  try { new Intl.DateTimeFormat("nl-NL", { timeZone: tz }); } catch { tz = TZ(); }
  const vandaag = datumSleutel(b.start, tz) === datumSleutel(nu, tz);
  const woord = vandaag ? "Vandaag" : datumSleutel(b.start, tz) === datumSleutel(nu + 86_400_000, tz) ? "Morgen" : `Op ${w.dag}`;
  return {
    onderwerp: `${woord} om ${w.tijd}: ${b.soort_naam}`,
    html: omhulsel(
      alinea(`Hi ${escapeHtml(voornaam(b.naam))},`) +
      alinea(`${woord} om <strong>${w.tijd}</strong>${escapeHtml(zoneSuffix(w.zone))} hebben we onze afspraak: ${escapeHtml(b.soort_naam)}, ${b.duur_min} minuten.`) +
      waarRegel(b) +
      alinea(`Lukt het toch niet? ${link("Verzetten of annuleren kan hier", beheerUrl(b.token))}.`) +
      afsluiting(vandaag ? "Tot zo!" : "Tot dan!"),
    ),
  };
}

export function annuleringMail(b: MailBoeking, door: "gast" | "eigenaar", reden?: string) {
  const w = wanneer(b.start, b.tijdzone_gast);
  if (door === "eigenaar") {
    return {
      onderwerp: `Onze afspraak van ${w.dag} gaat niet door`,
      html: omhulsel(
        alinea(`Hi ${escapeHtml(voornaam(b.naam))},`) +
        alinea(`Onze afspraak van ${w.dag} om ${w.tijd} gaat niet door.`) +
        (reden ? alinea(escapeHtml(reden).replace(/\n/g, "<br>")) : alinea(`Ik neem contact met je op voor een nieuw moment.`)) +
        afsluiting("Groet,"),
      ),
    };
  }
  return {
    onderwerp: `Je afspraak van ${w.dag} is geannuleerd`,
    html: omhulsel(
      alinea(`Hi ${escapeHtml(voornaam(b.naam))},`) +
      alinea(`Je afspraak van ${w.dag} om ${w.tijd} (${escapeHtml(b.soort_naam)}) is geannuleerd.`) +
      alinea(`Wil je een nieuw moment kiezen? ${link("Dat kan hier", `${paginaUrl()}/${b.soort_slug}`)}.`) +
      afsluiting("Groet,"),
    ),
  };
}

export function verzetMail(b: MailBoeking, oudeStart: number, door: "gast" | "eigenaar") {
  const nieuw = wanneer(b.start, b.tijdzone_gast);
  const oud = wanneer(oudeStart, b.tijdzone_gast);
  const naar = `<strong>${nieuw.dag} om ${nieuw.tijd}</strong>${escapeHtml(zoneSuffix(nieuw.zone))}`;
  const zin = door === "eigenaar"
    ? `Ik heb onze afspraak (${escapeHtml(b.soort_naam)}) verzet van ${oud.dag} ${oud.tijd} naar ${naar}. Komt dat niet uit, kies dan hieronder gerust een ander moment.`
    : `Onze afspraak (${escapeHtml(b.soort_naam)}) is verzet van ${oud.dag} ${oud.tijd} naar ${naar}.`;
  return {
    onderwerp: `Je afspraak is verzet naar ${nieuw.dag} om ${nieuw.tijd}`,
    html: omhulsel(
      alinea(`Hi ${escapeHtml(voornaam(b.naam))},`) + alinea(zin) + waarRegel(b) +
      alinea(`Nog een keer verzetten of annuleren? ${link("Dat kan hier", beheerUrl(b.token))}.`) +
      afsluiting("Tot dan!"),
    ),
  };
}

/** Platte tekst voor de melding aan jezelf. */
export function meldingTekst(b: MailBoeking, kop: string): string {
  const w = wanneer(b.start, TZ());
  return [
    kop, "",
    `Wie:      ${b.naam} <${b.email}>`,
    `Wat:      ${b.soort_naam} (${b.duur_min} min)`,
    `Wanneer:  ${w.dag} om ${w.tijd}`,
    ...(b.tijdzone_gast !== TZ() ? [`Tijdzone gast: ${b.tijdzone_gast}`] : []),
    ...(b.vergaderlink ? [`Link:     ${b.vergaderlink}`] : []),
    "",
    ...b.antwoorden.flatMap((a) => [a.vraag, `  ${a.antwoord || "-"}`]),
    "",
    `Zelf afzeggen (met reden) of verzetten: ${eigenaarUrl(b.token)}`,
  ].join("\n");
}

/** Beschrijving in het agenda-item: soort, antwoorden en de beheerlinks. */
export function agendaBeschrijving(b: MailBoeking, soortBeschrijving?: string): string {
  const kort = (t: string) => (t.length <= 5000 ? t : `${t.slice(0, 5000)}\n(... ingekort)`);
  return [
    b.soort_naam,
    ...(soortBeschrijving ? ["", soortBeschrijving] : []),
    "", `Gast: ${b.naam} <${b.email}>`,
    ...b.antwoorden.filter((a) => a.antwoord).flatMap((a) => ["", a.vraag, kort(a.antwoord)]),
    "", `Verzetten of annuleren (gast): ${beheerUrl(b.token)}`,
    `Afzeggen of verzetten (${voornaam(instellingen.eigenaar.naam)}): ${eigenaarUrl(b.token)}`,
  ].join("\n");
}

// ─── Versturen ──────────────────────────────────────────────────────────────

function base64(bytes: Uint8Array): string {
  const t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let uit = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    uit += t[a >> 2] + t[((a & 3) << 4) | ((b ?? 0) >> 4)]
      + (b === undefined ? "=" : t[((b & 15) << 2) | ((c ?? 0) >> 6)])
      + (c === undefined ? "=" : t[c & 63]);
  }
  return uit;
}
const utf8 = (s: string) => new TextEncoder().encode(s);
const kopTekst = (s: string) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${base64(utf8(s))}?=`);

/** Een mail volgens RFC 2822, voor de Gmail API. */
function mime(van: { naam: string; email: string }, aan: string, antwoordAan: string, onderwerp: string, html: string, platteTekst: boolean): string {
  const body = base64(utf8(html)).replace(/.{76}/g, "$&\r\n");
  return [
    `From: ${kopTekst(van.naam)} <${van.email}>`,
    `To: ${aan}`,
    `Reply-To: ${antwoordAan}`,
    `Subject: ${kopTekst(onderwerp)}`,
    "MIME-Version: 1.0",
    `Content-Type: ${platteTekst ? "text/plain" : "text/html"}; charset=UTF-8`,
    "Content-Transfer-Encoding: base64",
    "", body,
  ].join("\r\n");
}

export async function stuurMail(
  ctx: Ctx, aan: string, onderwerp: string, inhoud: string, opties: { platteTekst?: boolean } = {},
): Promise<{ ok: boolean; fout?: string }> {
  const m = instellingen.mail, eig = instellingen.eigenaar;
  if (m.via === "uit") return { ok: true };
  try {
    if (m.via === "resend") {
      const sleutel = process.env.RESEND_API_KEY;
      if (!sleutel) return { ok: false, fout: "RESEND_API_KEY ontbreekt in de Convex-omgeving" };
      const r = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${sleutel}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from: `${eig.naam} <${m.resend_afzender || eig.email}>`, to: [aan], subject: onderwerp,
          ...(opties.platteTekst ? { text: inhoud } : { html: inhoud }), reply_to: eig.email,
        }),
      });
      const d: any = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, fout: `Resend HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}` };
    }
    const token = await toegang(ctx);
    if (instellingen.agenda.aanbieder === "google") {
      const raw = base64(utf8(mime(eig, aan, eig.email, onderwerp, inhoud, !!opties.platteTekst)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      const r = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      const d: any = await r.json().catch(() => ({}));
      return r.ok ? { ok: true } : { ok: false, fout: `Gmail HTTP ${r.status} ${JSON.stringify(d).slice(0, 200)}` };
    }
    const r = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
      method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: onderwerp,
          body: { contentType: opties.platteTekst ? "Text" : "HTML", content: inhoud },
          toRecipients: [{ emailAddress: { address: aan } }],
          replyTo: [{ emailAddress: { address: eig.email } }],
        },
        saveToSentItems: true,
      }),
    });
    if (r.ok) return { ok: true };
    return { ok: false, fout: `Outlook HTTP ${r.status} ${(await r.text()).slice(0, 200)}` };
  } catch (e: any) {
    return { ok: false, fout: String(e?.message ?? e).slice(0, 200) };
  }
}

/** Melding aan jezelf (nieuwe boeking, afzegging, verzetting, storing). */
export async function meldMij(ctx: Ctx, onderwerp: string, tekst: string): Promise<void> {
  if (!instellingen.mail.meldingen_aan_mij) return;
  const r = await stuurMail(ctx, instellingen.eigenaar.email, onderwerp, tekst, { platteTekst: true });
  if (!r.ok) console.warn("melding aan eigenaar mislukt", r.fout);
}
