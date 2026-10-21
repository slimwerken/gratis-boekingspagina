// JOUW INSTELLINGEN. Alles wat per persoon verschilt staat in dit ene bestand.
//
// Geen sleutels hier: die staan in de Convex-omgeving (zie INSTALLEER-MIJ.md).
// Na een wijziging zet je de pagina opnieuw live met `npm run uitrollen`
// (of vraag het Claude: "zet mijn boekingspagina opnieuw live").
//
// Tijden zijn wandkloktijd in `tijdzone`. Dagen: 0 = zondag, 1 = maandag ... 6 = zaterdag.

export const instellingen: Instellingen = {
  // ── Wie ben je ────────────────────────────────────────────────────────────
  eigenaar: {
    naam: "Jouw Naam",
    // Hier komen de meldingen van nieuwe boekingen binnen, en dit is het
    // antwoordadres in elke mail aan je klant.
    email: "jij@voorbeeld.nl",
  },
  bedrijf: "Jouw Bedrijf",
  tijdzone: "Europe/Amsterdam",

  // ── Je agenda ─────────────────────────────────────────────────────────────
  // "google" (Gmail / Google Workspace) of "microsoft" (Outlook.com / Microsoft 365).
  agenda: {
    aanbieder: "google",
    // Waar de afspraak in komt. "primary" = je hoofdagenda (Google) of je
    // standaardagenda (Outlook). Een andere agenda: zet hier zijn ID.
    afspraak_in: "primary",
    // In welke agenda's kijken we of je bezet bent? Leeg = alleen de agenda hierboven.
    // Google: e-mailadressen of agenda-ID's. Outlook: agenda-ID's van je eigen account.
    bezet_uit: [],
    // Een online vergadering erbij: Google Meet (Google) of Microsoft Teams (Microsoft).
    online_vergadering: true,
  },

  // ── Mail ──────────────────────────────────────────────────────────────────
  // "agenda" = vanaf je eigen Gmail of Outlook (geen extra account nodig).
  // "resend" = via Resend, met je eigen domein (zet dan RESEND_API_KEY).
  // "uit"    = geen eigen mails; alleen de uitnodiging die Google of Outlook zelf stuurt.
  mail: {
    via: "agenda",
    // Alleen bij "resend": het afzenderadres op jouw geverifieerde domein.
    resend_afzender: "",
    herinnering_uren_vooraf: 24,
    meldingen_aan_mij: true,
  },

  // ── Hoe de pagina eruitziet ───────────────────────────────────────────────
  uiterlijk: {
    titel: "Plan een afspraak",
    intro: "Kies wat je wilt bespreken, dan zie je meteen wanneer er plek is.",
    kleur_accent: "#2563EB",
    kleur_tekst: "#0F172A",
    kleur_achtergrond: "#F4F5F7",
    // Optioneel: een link naar je logo (png/svg) en je eigen website.
    logo_url: "",
    website: "",
  },

  // ── Standaardregels (gelden voor elke soort, tenzij die ze zelf overschrijft) ──
  standaard: {
    rooster: [
      { dag: 1, van: "09:00", tot: "17:00" },
      { dag: 2, van: "09:00", tot: "17:00" },
      { dag: 3, van: "09:00", tot: "17:00" },
      { dag: 4, van: "09:00", tot: "17:00" },
      { dag: 5, van: "09:00", tot: "17:00" },
    ],
    buffer_voor_min: 5,
    buffer_na_min: 5,
    min_aankondiging_uur: 24, // niemand boekt je voor over een uur
    horizon_dagen: 60,        // hoe ver vooruit mensen kunnen boeken
    stap_min: 30,             // om de hoeveel minuten er een starttijd is
  },
  // Hooguit zoveel afspraken per dag, over alle soorten samen. Weglaten = geen maximum.
  max_afspraken_per_dag: 4,

  // ── Je soorten afspraken ──────────────────────────────────────────────────
  // slug = het stukje in de link: <jouw-adres>/kennismaking
  soorten: [
    {
      slug: "kennismaking",
      naam: "Kennismaking",
      duur_min: 30,
      beschrijving: "Een half uur om kennis te maken en te kijken of we iets voor elkaar kunnen betekenen.",
      vragen: [
        { id: "waarover", label: "Waar wil je het over hebben?", soort: "tekst", verplicht: true },
        { id: "telefoon", label: "Telefoonnummer", soort: "telefoon", verplicht: false },
      ],
    },
    {
      slug: "uur",
      naam: "Gesprek van een uur",
      duur_min: 60,
      beschrijving: "Een uur voor een inhoudelijk gesprek.",
      vragen: [
        { id: "waarover", label: "Wat wil je bereiken met dit gesprek?", soort: "tekst", verplicht: true },
      ],
    },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Hieronder hoef je niets aan te passen.

export type Vraag = {
  id: string;
  label: string;
  soort: "tekst" | "regel" | "telefoon" | "keuze" | "meerkeuze";
  verplicht: boolean;
  opties?: string[];
};
export type RoosterBlok = { dag: number; van: string; tot: string };
export type Regels = {
  rooster: RoosterBlok[];
  buffer_voor_min: number;
  buffer_na_min: number;
  min_aankondiging_uur: number;
  horizon_dagen: number;
  stap_min: number;
};
export type Soort = Partial<Regels> & {
  slug: string;
  naam: string;
  duur_min: number;
  beschrijving?: string;
  vragen?: Vraag[];
  // Een vaste plek in plaats van een online vergadering, bijv. "Kantoor, Dorpsstraat 1, Wamel" of "Ik bel je".
  locatie?: string;
  // Wel te boeken via de link, niet zichtbaar in het overzicht.
  verborgen?: boolean;
  // Tijdelijk uit zonder hem weg te gooien.
  uit?: boolean;
};
export type Instellingen = {
  eigenaar: { naam: string; email: string };
  bedrijf: string;
  tijdzone: string;
  agenda: { aanbieder: "google" | "microsoft"; afspraak_in: string; bezet_uit: string[]; online_vergadering: boolean };
  mail: { via: "agenda" | "resend" | "uit"; resend_afzender: string; herinnering_uren_vooraf: number; meldingen_aan_mij: boolean };
  uiterlijk: { titel: string; intro: string; kleur_accent: string; kleur_tekst: string; kleur_achtergrond: string; logo_url: string; website: string };
  standaard: Regels;
  max_afspraken_per_dag?: number;
  soorten: Soort[];
};

/** Een soort met alle standaardregels ingevuld. */
export type VolleSoort = Regels & Required<Pick<Soort, "slug" | "naam" | "duur_min">> & {
  beschrijving: string; vragen: Vraag[]; locatie?: string; verborgen: boolean; uit: boolean;
  max_per_dag?: number;
};

export function soortOpSlug(slug: string): VolleSoort | null {
  const s = instellingen.soorten.find((x) => x.slug === slug);
  return s ? vul(s) : null;
}

export function zichtbareSoorten(): VolleSoort[] {
  return instellingen.soorten.map(vul).filter((s) => !s.uit && !s.verborgen);
}

function vul(s: Soort): VolleSoort {
  const d = instellingen.standaard;
  return {
    slug: s.slug, naam: s.naam, duur_min: s.duur_min,
    beschrijving: s.beschrijving ?? "", vragen: s.vragen ?? [], locatie: s.locatie,
    verborgen: !!s.verborgen, uit: !!s.uit,
    rooster: s.rooster ?? d.rooster,
    buffer_voor_min: s.buffer_voor_min ?? d.buffer_voor_min,
    buffer_na_min: s.buffer_na_min ?? d.buffer_na_min,
    min_aankondiging_uur: s.min_aankondiging_uur ?? d.min_aankondiging_uur,
    horizon_dagen: s.horizon_dagen ?? d.horizon_dagen,
    stap_min: s.stap_min ?? d.stap_min,
    max_per_dag: instellingen.max_afspraken_per_dag,
  };
}

/** Wat er naar de bezoeker gaat over de vergaderplek. */
export function plekTekst(s: { locatie?: string }): string {
  if (s.locatie) return s.locatie;
  if (!instellingen.agenda.online_vergadering) return "";
  return instellingen.agenda.aanbieder === "microsoft" ? "Microsoft Teams" : "Google Meet";
}
