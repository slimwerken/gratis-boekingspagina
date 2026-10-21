// De slot-motor: welke starttijden zijn vrij?
//
// Puur: geen Convex, geen fetch, geen Date.now(). Alles wat van buiten komt
// (nu, rooster, bezet) gaat erin als argument, zodat hij te testen is
// (tests/slots.test.ts). Tijden zijn ms UTC; het rooster staat in wandkloktijd
// van je tijdzone en de omrekening gaat via Intl, zodat zomer- en wintertijd
// goed gaan zonder bibliotheek.

/** Alleen de terugval; de echte tijdzone komt uit instellingen.ts. */
export const TIJDZONE = "Europe/Amsterdam";

/** Een blok uit het rooster. dag: 0 = zondag ... 6 = zaterdag. van/tot als "09:00". */
export type RoosterBlok = { dag: number; van: string; tot: string };
/** Een bezet stuk (agenda of bestaande boeking), ms UTC. */
export type Blok = { start: number; einde: number };

export type TypeRegels = {
  duur_min: number;
  rooster: RoosterBlok[];
  buffer_voor_min: number;
  buffer_na_min: number;
  min_aankondiging_uur: number;
  horizon_dagen: number;
  stap_min: number;
  max_per_dag?: number;
};

const MIN = 60_000;
const UUR = 60 * MIN;
const DAG = 24 * UUR;

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz, hourCycle: "h23",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
    dtfCache.set(tz, f);
  }
  return f;
}

export type Wandklok = {
  jaar: number; maand: number; dag: number;
  uur: number; minuut: number; seconde: number;
  weekdag: number; // 0 = zondag
};

/** Wat de klok aan de muur in `tz` aanwijst op dit UTC-moment. */
export function wandklok(utcMs: number, tz: string = TIJDZONE): Wandklok {
  const p: Record<string, string> = {};
  for (const deel of dtf(tz).formatToParts(new Date(utcMs))) p[deel.type] = deel.value;
  const jaar = +p.year, maand = +p.month, dag = +p.day;
  let uur = +p.hour;
  if (uur === 24) uur = 0; // sommige engines geven "24" om middernacht
  return {
    jaar, maand, dag, uur, minuut: +p.minute, seconde: +p.second,
    weekdag: new Date(Date.UTC(jaar, maand - 1, dag)).getUTCDay(),
  };
}

function offsetMs(utcMs: number, tz: string): number {
  const w = wandklok(utcMs, tz);
  const alsUtc = Date.UTC(w.jaar, w.maand - 1, w.dag, w.uur, w.minuut, w.seconde);
  return alsUtc - Math.floor(utcMs / 1000) * 1000;
}

/** Wandkloktijd in `tz` naar ms UTC. Bij de overgang naar wintertijd (een uur
 *  dat twee keer bestaat) wint de eerste; bij de overgang naar zomertijd (een
 *  uur dat niet bestaat) schuift hij door naar de eerstvolgende echte tijd. */
export function lokaalNaarUtc(
  jaar: number, maand: number, dag: number, uur: number, minuut: number, tz: string = TIJDZONE,
): number {
  const gok = Date.UTC(jaar, maand - 1, dag, uur, minuut);
  const o1 = offsetMs(gok, tz);
  let utc = gok - o1;
  const o2 = offsetMs(utc, tz);
  if (o2 !== o1) utc = gok - o2;
  return utc;
}

/** "2026-09-07" voor het UTC-moment, gezien vanuit `tz`. */
export function datumSleutel(utcMs: number, tz: string = TIJDZONE): string {
  const w = wandklok(utcMs, tz);
  return `${w.jaar}-${String(w.maand).padStart(2, "0")}-${String(w.dag).padStart(2, "0")}`;
}

function parseKlok(s: string): [number, number] {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`ongeldige kloktijd: ${s}`);
  return [h, m];
}

/** Raakt [start - bufferVoor, einde + bufferNa] een bezet blok? Grenzen die
 *  precies aansluiten (einde == start) tellen niet als raken. */
export function raaktBezet(
  start: number, einde: number, bufferVoorMin: number, bufferNaMin: number, bezet: Blok[],
): boolean {
  const van = start - bufferVoorMin * MIN;
  const tot = einde + bufferNaMin * MIN;
  for (const b of bezet) {
    if (van < b.einde && tot > b.start) return true;
  }
  return false;
}

export type SlotsOpties = {
  nu: number;
  type: TypeRegels;
  van: number;              // eerste moment dat meetelt (ms UTC)
  tot: number;              // laatste moment dat meetelt (ms UTC)
  bezet: Blok[];
  /** Aantal boekingen per lokale dag ("2026-09-07": 2), over alle soorten samen, voor max_per_dag. */
  boekingenPerDag?: Record<string, number>;
  tz?: string;
};

/** Alle boekbare starttijden (ms UTC), oplopend, zonder dubbelen. */
export function berekenSlots(o: SlotsOpties): number[] {
  const tz = o.tz ?? TIJDZONE;
  const t = o.type;
  const duur = t.duur_min * MIN;
  const stap = Math.max(5, t.stap_min) * MIN;
  const vroegst = Math.max(o.van, o.nu + t.min_aankondiging_uur * UUR);
  const laatst = Math.min(o.tot, o.nu + t.horizon_dagen * DAG);
  if (vroegst > laatst) return [];

  const bezet = [...o.bezet].sort((a, b) => a.start - b.start);
  const uit = new Set<number>();

  // Loop over lokale kalenderdagen van `van` tot en met `tot`.
  const eerste = wandklok(o.van, tz);
  const laatste = wandklok(o.tot, tz);
  let cursor = Date.UTC(eerste.jaar, eerste.maand - 1, eerste.dag);
  const eind = Date.UTC(laatste.jaar, laatste.maand - 1, laatste.dag);

  while (cursor <= eind) {
    const d = new Date(cursor);
    const jaar = d.getUTCFullYear(), maand = d.getUTCMonth() + 1, dag = d.getUTCDate();
    const weekdag = d.getUTCDay();
    const sleutel = `${jaar}-${String(maand).padStart(2, "0")}-${String(dag).padStart(2, "0")}`;
    const alGeboekt = o.boekingenPerDag?.[sleutel] ?? 0;
    const vol = t.max_per_dag !== undefined && alGeboekt >= t.max_per_dag;

    if (!vol) {
      for (const blok of t.rooster) {
        if (blok.dag !== weekdag) continue;
        const [vh, vm] = parseKlok(blok.van);
        const [th, tm] = parseKlok(blok.tot);
        const vensterStart = lokaalNaarUtc(jaar, maand, dag, vh, vm, tz);
        const vensterEind = lokaalNaarUtc(jaar, maand, dag, th, tm, tz);
        for (let s = vensterStart; s + duur <= vensterEind; s += stap) {
          if (s < vroegst || s > laatst) continue;
          if (raaktBezet(s, s + duur, t.buffer_voor_min, t.buffer_na_min, bezet)) continue;
          uit.add(s);
        }
      }
    }
    cursor += DAG;
  }
  return [...uit].sort((a, b) => a - b);
}

/** Bestaande boekingen als bezet-blokken, met hun eigen buffers erbij. Zo
 *  respecteert een nieuwe boeking de buffer van een oude, ook al staat die
 *  buffer niet als los agenda-item. */
export function boekingenAlsBezet(
  boekingen: { start: number; einde: number; buffer_voor_min: number; buffer_na_min: number }[],
): Blok[] {
  return boekingen.map((b) => ({
    start: b.start - b.buffer_voor_min * MIN,
    einde: b.einde + b.buffer_na_min * MIN,
  }));
}
