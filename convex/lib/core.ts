// Resolution logic shared by the Convex resolver and the edge Worker.
// No Convex imports: callers provide a Source that reads from the database
// (Convex) or from a cached snapshot (the Worker).
import { argsFit, candidates, fillTemplate, normalizeQuery, parseQuery, searchUrl } from "./go";

export type Vars = Record<string, string>;
export type LinkLite = { id: string; scope: "global" | "team" | "user"; scopeId: string; keyword: string; url: string; emptyUrl?: string };
export type UserLite = { id: string; vars: Vars; fallbackSearch: string; llmEnabled: boolean; llmMy: boolean; primaryTeamId?: string };

export interface Source {
  user: UserLite | null;
  scopes: string[]; // lookup order: user id, team ids (primary first), "global"
  teamVars(teamId: string): Promise<Vars> | Vars;
  link(scopeId: string, keyword: string): Promise<LinkLite | null> | LinkLite | null;
  learned(queryNorm: string): Promise<string | null> | string | null; // kept LLM answer
}

export type Resolution =
  | { kind: "redirect"; url: string; via: "shortcut" | "learned"; linkId?: string; keyword?: string; scope?: string }
  | { kind: "think"; q: string }
  | { kind: "search"; url: string }
  | { kind: "create"; keyword: string }
  | { kind: "info"; keyword: string }
  | { kind: "home" };

export async function resolveWith(src: Source, q: string, llmAvailable: boolean): Promise<Resolution> {
  const parsed = parseQuery(q);
  if (parsed.kind === "home") return { kind: "home" };
  if (parsed.kind === "info") return { kind: "info", keyword: parsed.keyword };
  const { user } = src;
  const primary = user?.primaryTeamId ?? src.scopes.find((s) => s !== user?.id && s !== "global");

  if (!parsed.askLlm) {
    for (const c of candidates(parsed.lower)) {
      for (const scopeId of src.scopes) {
        const link = await src.link(scopeId, c.keyword);
        if (!link) continue;
        const args = parsed.words.slice(c.n);
        // Words the template has no slot for: not this shortcut. Keep looking
        // (another scope's link may take args), else fall through to search.
        if (!argsFit(link.url, args)) continue;
        const teamId = link.scope === "team" ? link.scopeId : primary;
        const vars = { me: user?.vars ?? {}, team: teamId ? await src.teamVars(teamId) : {} };
        let url = fillTemplate(link.url, args, vars);
        if (url === null && args.length === 0 && link.emptyUrl) url = fillTemplate(link.emptyUrl, [], vars);
        if (url === null) return { kind: "info", keyword: link.keyword };
        return { kind: "redirect", url, via: "shortcut", linkId: link.id, keyword: link.keyword, scope: link.scope };
      }
    }
  }

  if (user) {
    const kept = await src.learned(normalizeQuery(parsed.raw));
    if (kept) return { kind: "redirect", url: kept, via: "learned" };
  }

  const wantsLlm = parsed.askLlm || (user?.llmMy === true && parsed.lower[0] === "my" && parsed.words.length > 1);
  if (wantsLlm && llmAvailable && user?.llmEnabled) return { kind: "think", q: parsed.raw };
  if (parsed.explicit && parsed.words.length === 1) return { kind: "create", keyword: parsed.lower[0] };
  return { kind: "search", url: searchUrl(user?.fallbackSearch ?? "google", parsed.raw) };
}
