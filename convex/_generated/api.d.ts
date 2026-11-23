/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as edge from "../edge.js";
import type * as http from "../http.js";
import type * as lib_assets from "../lib/assets.js";
import type * as lib_auth from "../lib/auth.js";
import type * as lib_core from "../lib/core.js";
import type * as lib_edgeRows from "../lib/edgeRows.js";
import type * as lib_go from "../lib/go.js";
import type * as lib_random from "../lib/random.js";
import type * as lib_recipes from "../lib/recipes.js";
import type * as lib_sha256 from "../lib/sha256.js";
import type * as links from "../links.js";
import type * as llm from "../llm.js";
import type * as resolve from "../resolve.js";
import type * as seed from "../seed.js";
import type * as teams from "../teams.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  edge: typeof edge;
  http: typeof http;
  "lib/assets": typeof lib_assets;
  "lib/auth": typeof lib_auth;
  "lib/core": typeof lib_core;
  "lib/edgeRows": typeof lib_edgeRows;
  "lib/go": typeof lib_go;
  "lib/random": typeof lib_random;
  "lib/recipes": typeof lib_recipes;
  "lib/sha256": typeof lib_sha256;
  links: typeof links;
  llm: typeof llm;
  resolve: typeof resolve;
  seed: typeof seed;
  teams: typeof teams;
  users: typeof users;
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
