// The rows an edge keeps, and the change feed that keeps them current.
// Shared by Convex (which writes the feed) and the edges (which read it).
// No Convex imports.
import type { LinkLite, Vars } from "./core";

export type EdgeUser = {
  id: string;
  vars: Vars;
  fallbackSearch: string;
  llmEnabled: boolean;
  llmMy: boolean;
  primaryTeamId?: string;
  teamIds: string[]; // primary team first
};
export type EdgeToken = { id: string; hash: string; userId: string };
export type EdgeTeam = { id: string; vars: Vars };
export type EdgeLearned = { id: string; userId: string; queryNorm: string; url: string; at: number };

export type EdgeRows = {
  links: LinkLite;
  users: EdgeUser;
  tokens: EdgeToken;
  teams: EdgeTeam;
  learned: EdgeLearned;
};
export type EdgeTable = keyof EdgeRows;
export const EDGE_TABLES: EdgeTable[] = ["links", "users", "tokens", "teams", "learned"];

/** One entry in the change feed. row null = deleted. */
export type Change = { [T in EdgeTable]: { seq: number; table: T; id: string; row: EdgeRows[T] | null } }[EdgeTable];

/** GET /api/edge/changes?after=N */
export type ChangesPage = { seq: number; llm: boolean; reset: boolean; more: boolean; changes: Change[] };

/** GET /api/edge/dump: everything, as of seq. */
export type Dump = { seq: number; llm: boolean } & { [T in EdgeTable]: EdgeRows[T][] };
