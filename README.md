# Gratis boekingspagina

Je eigen Calendly, zonder abonnement. Mensen kiezen een vrije tijd in je agenda, de afspraak
staat meteen in Google Agenda of Outlook (met Meet- of Teams-link), en iedereen krijgt de
juiste mails. Draait op het gratis plan van [Convex](https://convex.dev); geen hosting nodig.

**Installeren:** open deze map in Claude Code (de Claude-app, tabblad Code) en plak:

```
Lees INSTALLEER-MIJ.md en installeer mijn boekingspagina. Neem me stap voor stap mee en leg bij elke stap uit wat je doet en waarom.
```

## Wat het doet

- Overzichtspagina met je soorten afspraken, per soort een kalender met alleen echt vrije tijden
- Kijkt in een of meer agenda's (Google of Outlook), houdt rekening met buffers, minimale aankondiging, maximum per dag, zomer- en wintertijd en de tijdzone van je gast
- Zet de afspraak in je agenda met je gast als deelnemer, plus Google Meet of Microsoft Teams
- Mails vanaf je eigen Gmail of Outlook (of via Resend): bevestiging, herinnering, annulering, verzetting, en een melding aan jou
- Je gast verzet of annuleert zelf via een persoonlijke link
- Jij zegt af met een reden (die je gast letterlijk leest) of verzet, vanaf elke telefoon
- Sleep of verwijder je de afspraak in je agenda, dan volgt de pagina binnen een kwartier en mailt je gast
- Geen dubbele boekingen, ook niet als twee mensen tegelijk op dezelfde tijd klikken

## Hoe het in elkaar zit

| Bestand | Wat |
|---|---|
| `convex/instellingen.ts` | **Alles wat per persoon verschilt**: naam, rooster, soorten, kleuren, mailroute |
| `convex/slots.ts` | De rekenmotor voor vrije tijden (getest in `tests/`) |
| `convex/afspraak.ts` | Boeken, annuleren, verzetten, herinneren |
| `convex/agenda.ts` | Google Calendar en Microsoft Graph |
| `convex/mail.ts` | De mailteksten en het versturen |
| `convex/http.ts` | De pagina en de API |
| `pagina/index.html` | De pagina zelf (een bestand, geen build) |
| `scripts/koppel.mjs` | Agenda koppelen en sleutels in Convex zetten |

Sleutels staan nooit in de code, alleen in de Convex-omgeving.

## Licentie

MIT. Gebruik het, pas het aan, deel het.

Gemaakt door [Bart Boonstra](https://slimwerken.ai). Wil je leren zelf dit soort systemen te
bouwen met AI? Kijk op [hetmainframe.nl](https://hetmainframe.nl).
