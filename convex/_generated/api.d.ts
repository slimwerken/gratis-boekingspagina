/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as afspraak from "../afspraak.js";
import type * as agenda from "../agenda.js";
import type * as beheer from "../beheer.js";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as instellingen from "../instellingen.js";
import type * as koppeling from "../koppeling.js";
import type * as mail from "../mail.js";
import type * as pagina_html from "../pagina_html.js";
import type * as slots from "../slots.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  afspraak: typeof afspraak;
  agenda: typeof agenda;
  beheer: typeof beheer;
  crons: typeof crons;
  http: typeof http;
  instellingen: typeof instellingen;
  koppeling: typeof koppeling;
  mail: typeof mail;
  pagina_html: typeof pagina_html;
  slots: typeof slots;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
