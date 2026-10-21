import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Herinneringen sturen en half afgemaakte reserveringen opruimen.
crons.interval("herinneringen", { minutes: 15 }, internal.afspraak.herinneringen, {});
// Wat jij in je agenda versleept of weggooit, volgt de boekingspagina (en je gast krijgt een mail).
crons.interval("agenda-controle", { minutes: 15 }, internal.afspraak.agendaControle, {});
// De koppeling vers houden en een probleem zien voordat een klant het ziet.
crons.daily("koppeling-controle", { hourUTC: 5, minuteUTC: 0 }, internal.afspraak.koppelingControle, {});

export default crons;
