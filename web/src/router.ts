import { useSyncExternalStore } from "react";

const subs = new Set<() => void>();
const notify = () => subs.forEach((f) => f());
addEventListener("popstate", notify);

export function navigate(to: string, replace = false) {
  if (replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  scrollTo({ top: 0 });
  notify();
}

export function useLocation() {
  const href = useSyncExternalStore(
    (f) => (subs.add(f), () => subs.delete(f)),
    () => location.pathname + location.search + location.hash,
  );
  const u = new URL(href, location.origin);
  return { path: u.pathname, params: u.searchParams, hash: u.hash };
}

/** <a> that routes inside the app. */
export function linkProps(to: string) {
  return {
    href: to,
    onClick: (e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; button: number; preventDefault(): void }) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(to);
    },
  };
}
