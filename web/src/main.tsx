import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { CONVEX_URL, SEARCH_BASE, SITE_URL } from "./config";
import { pokeEdge } from "./store";
import { App } from "./App";
import "./styles.css";

const convex = new ConvexReactClient(CONVEX_URL);

// After any change (shortcut, settings, team), refresh the edge copy this
// browser's searches are served from, so edits apply on the next search.
for (const m of ["mutation", "action"] as const) {
  const orig = convex[m].bind(convex) as (...a: unknown[]) => Promise<unknown>;
  (convex as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => {
    const r = await orig(...a);
    pokeEdge(SEARCH_BASE, SITE_URL);
    return r;
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ConvexProvider client={convex}>
      <App />
    </ConvexProvider>
  </StrictMode>,
);
