// De slot-motor: welke starttijden zijn vrij. Puur rekenwerk, dus snel te
// testen zonder agenda of database. Draai met: npm test
import { describe, expect, it } from "vitest";
import {
  berekenSlots, boekingenAlsBezet, datumSleutel, lokaalNaarUtc, raaktBezet, wandklok,
  type TypeRegels,
} from "../convex/slots";

const iso = (ms: number) => new Date(ms).toISOString().replace(".000Z", "Z");

// "nu" voor de losse regel-tests: ver genoeg terug dat de horizon van 365 dagen niet in de weg zit.
const NU0 = lokaalNaarUtc(2026, 1, 1, 0, 0);

const basis: TypeRegels = {
  duur_min: 30, rooster: [{ dag: 0, van: "09:00", tot: "11:00" }],
  buffer_voor_min: 0, buffer_na_min: 0, min_aankondiging_uur: 0, horizon_dagen: 365, stap_min: 30,
};

describe("wandklok en tijdzone", () => {
  it("zomertijd: 9:00 in Amsterdam op 24 okt 2026 is 07:00Z", () => {
    expect(iso(lokaalNaarUtc(2026, 10, 24, 9, 0))).toBe("2026-10-24T07:00:00Z");
  });
  it("wintertijd: 9:00 in Amsterdam op 25 okt 2026 (dag van de overgang) is 08:00Z", () => {
    expect(iso(lokaalNaarUtc(2026, 10, 25, 9, 0))).toBe("2026-10-25T08:00:00Z");
  });
  it("wandklok leest terug wat lokaalNaarUtc erin stopte, ook rond de overgang", () => {
    for (const [j, m, d, u, mi] of [[2026, 10, 25, 1, 30], [2026, 10, 25, 3, 30], [2026, 3, 29, 3, 30], [2026, 12, 31, 23, 59]]) {
      const w = wandklok(lokaalNaarUtc(j, m, d, u, mi));
      expect([w.jaar, w.maand, w.dag, w.uur, w.minuut]).toEqual([j, m, d, u, mi]);
    }
  });
  it("datumSleutel kijkt naar de lokale dag, niet de UTC-dag", () => {
    // 23:30 lokaal op 7 sep is 21:30Z op 7 sep; 00:30 lokaal op 8 sep is 22:30Z op 7 sep.
    expect(datumSleutel(lokaalNaarUtc(2026, 9, 8, 0, 30))).toBe("2026-09-08");
  });
  it("een rooster op de dag van de wintertijd-overgang geeft slots in wintertijd", () => {
    const slots = berekenSlots({ nu: NU0, type: basis, van: lokaalNaarUtc(2026, 10, 25, 0, 0), tot: lokaalNaarUtc(2026, 10, 25, 23, 59), bezet: [] }).map(iso);
    expect(slots).toEqual(["2026-10-25T08:00:00Z", "2026-10-25T08:30:00Z", "2026-10-25T09:00:00Z", "2026-10-25T09:30:00Z"]);
  });
});

describe("regels", () => {
  const zondag = { van: lokaalNaarUtc(2026, 9, 6, 0, 0), tot: lokaalNaarUtc(2026, 9, 6, 23, 59) };
  it("een bezet blok dat precies aansluit blokkeert niet zonder buffer, wel met buffer", () => {
    const bezet = [{ start: lokaalNaarUtc(2026, 9, 6, 10, 0), einde: lokaalNaarUtc(2026, 9, 6, 10, 30) }];
    const zonder = berekenSlots({ nu: NU0, type: basis, ...zondag, bezet }).map((ms) => wandklok(ms).uur * 100 + wandklok(ms).minuut);
    expect(zonder).toEqual([900, 930, 1030]);
    const met = berekenSlots({ nu: NU0, type: { ...basis, buffer_voor_min: 5, buffer_na_min: 5 }, ...zondag, bezet })
      .map((ms) => wandklok(ms).uur * 100 + wandklok(ms).minuut);
    expect(met).toEqual([900]);
  });
  it("minimale aankondiging schuift de eerste slot op", () => {
    const nu = lokaalNaarUtc(2026, 9, 6, 8, 45);
    const slots = berekenSlots({ nu, type: { ...basis, min_aankondiging_uur: 1 }, ...zondag, bezet: [] })
      .map((ms) => wandklok(ms).uur * 100 + wandklok(ms).minuut);
    expect(slots).toEqual([1000, 1030]);
  });
  it("horizon: niets voorbij nu + horizon_dagen", () => {
    const nu = lokaalNaarUtc(2026, 9, 5, 12, 0);
    const slots = berekenSlots({ nu, type: { ...basis, horizon_dagen: 1 }, van: nu, tot: nu + 30 * 86_400_000, bezet: [] });
    expect(slots.map(iso)).toEqual(["2026-09-06T07:00:00Z", "2026-09-06T07:30:00Z", "2026-09-06T08:00:00Z", "2026-09-06T08:30:00Z"]);
  });
  it("max_per_dag: een volle dag geeft niets, een andere dag wel", () => {
    const type = { ...basis, max_per_dag: 1 };
    const van = lokaalNaarUtc(2026, 9, 6, 0, 0), tot = lokaalNaarUtc(2026, 9, 13, 23, 59);
    const slots = berekenSlots({ nu: NU0, type, van, tot, bezet: [], boekingenPerDag: { "2026-09-06": 1 } });
    expect(slots.every((ms) => datumSleutel(ms) === "2026-09-13")).toBe(true);
    expect(slots).toHaveLength(4);
  });
  it("een afspraak moet helemaal in het venster passen (einde op de rand mag)", () => {
    const slots = berekenSlots({ nu: NU0, type: { ...basis, duur_min: 90 }, ...zondag, bezet: [] })
      .map((ms) => wandklok(ms).uur * 100 + wandklok(ms).minuut);
    expect(slots).toEqual([900, 930]);
  });
  it("boekingenAlsBezet rekent de buffers van de oude boeking mee", () => {
    const b = boekingenAlsBezet([{ start: 1_000_000, einde: 2_000_000, buffer_voor_min: 5, buffer_na_min: 10 }]);
    expect(b).toEqual([{ start: 700_000, einde: 2_600_000 }]);
    expect(raaktBezet(2_500_000, 2_800_000, 0, 0, b)).toBe(true);
    expect(raaktBezet(2_600_000, 2_800_000, 0, 0, b)).toBe(false);
  });
});

describe("andere tijdzone", () => {
  it("een rooster in Europe/London rekent in Londense tijd", () => {
    const tz = "Europe/London";
    const van = lokaalNaarUtc(2026, 9, 6, 0, 0, tz), tot = lokaalNaarUtc(2026, 9, 6, 23, 59, tz);
    const slots = berekenSlots({ nu: NU0, type: basis, van, tot, bezet: [], tz }).map(iso);
    expect(slots[0]).toBe("2026-09-06T08:00:00Z");
  });
});
