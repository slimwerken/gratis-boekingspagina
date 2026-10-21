import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Een boeking. `in_aanmaak` bestaat alleen tussen het reserveren en het
  // aanmaken van het agenda-item; mislukt dat, dan gaat de rij weer weg.
  afspraken: defineTable({
    soort_slug: v.string(),
    soort_naam: v.string(),
    duur_min: v.number(),
    start: v.number(),                      // ms UTC
    einde: v.number(),
    buffer_voor_min: v.number(),            // kopie van de soort op het boekmoment
    buffer_na_min: v.number(),
    naam: v.string(),
    email: v.string(),
    antwoorden: v.array(v.object({ vraag: v.string(), antwoord: v.string() })),
    tijdzone_gast: v.string(),
    status: v.union(v.literal("in_aanmaak"), v.literal("actief"), v.literal("geannuleerd")),
    token: v.string(),                      // de persoonlijke beheerlink van de gast
    agenda_item_id: v.optional(v.string()),
    vergaderlink: v.optional(v.string()),
    geboekt_op: v.number(),
    geannuleerd_op: v.optional(v.number()),
    annuleer_reden: v.optional(v.string()),
    geannuleerd_door: v.optional(v.string()), // "gast" of "eigenaar"
    verzet_van_start: v.optional(v.number()),
    verzet_op: v.optional(v.number()),
    herinnering_verzonden: v.array(v.number()), // uren-vooraf die al gemaild zijn, bijv. [24]
    ip_hash: v.optional(v.string()),
  })
    .index("by_token", ["token"])
    .index("by_start", ["start"])
    .index("by_email", ["email"])
    .index("by_status_start", ["status", "start"])
    .index("by_geboekt", ["geboekt_op"])
    .index("by_ip", ["ip_hash", "geboekt_op"]),

  // Vrij/bezet uit je agenda, 60 seconden geldig. Scheelt een aanroep per
  // klik als iemand tussen maanden heen en weer gaat.
  bezet_cache: defineTable({
    sleutel: v.string(),
    van: v.number(),
    tot: v.number(),
    bezet: v.array(v.object({ start: v.number(), einde: v.number() })),
    opgehaald_op: v.number(),
  }).index("by_sleutel", ["sleutel"]),

  // De koppeling met Google of Microsoft: het laatste toegangsbewijs en, bij
  // Microsoft, de nieuwste vernieuw-sleutel (die wisselt bij elk gebruik).
  // Alleen te lezen vanuit de server, nooit via een publieke route.
  koppeling: defineTable({
    aanbieder: v.string(),
    access_token: v.optional(v.string()),
    verloopt_op: v.optional(v.number()),
    refresh_token: v.optional(v.string()),
    // Vingerafdruk van de vernieuw-sleutel uit de omgeving: koppel je opnieuw,
    // dan wint de nieuwe sleutel uit de omgeving van de bewaarde.
    env_vingerafdruk: v.optional(v.string()),
    laatst_gelukt: v.optional(v.number()),
    laatste_fout: v.optional(v.string()),
    laatste_fout_op: v.optional(v.number()),
  }).index("by_aanbieder", ["aanbieder"]),
});
