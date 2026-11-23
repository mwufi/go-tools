import { useSyncExternalStore } from "react";

// The web app keeps the user's tokens in this browser only.
type Session = { apiToken: string; searchToken?: string } | null;
const KEY = "go-tools.session";

function read(): Session {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
}
let session = read();
const subs = new Set<() => void>();

export function setSession(s: Session) {
  session = s;
  try {
    if (s) localStorage.setItem(KEY, JSON.stringify(s));
    else localStorage.removeItem(KEY);
  } catch {
    /* private mode: session lives for this tab only */
  }
  subs.forEach((f) => f());
}

export function useSession(): Session {
  return useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => session,
  );
}

export function searchUrlFor(siteUrl: string, searchToken?: string) {
  return `${siteUrl}/s?q=%s${searchToken ? `&t=${searchToken}` : ""}`;
}

/** Tell this browser's edge location to refetch our shortcuts right away. */
export function pokeEdge(edgeUrl: string, siteUrl: string) {
  if (!session?.searchToken || edgeUrl === siteUrl) return;
  fetch(`${edgeUrl}/_refresh?t=${encodeURIComponent(session.searchToken)}`, { mode: "no-cors", keepalive: true }).catch(() => {});
}
