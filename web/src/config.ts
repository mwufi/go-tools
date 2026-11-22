declare global {
  interface Window { __GO__?: { convexUrl: string; siteUrl: string; llm: boolean } }
}
const injected = window.__GO__;
export const CONVEX_URL: string = injected?.convexUrl ?? import.meta.env.VITE_CONVEX_URL;
export const SITE_URL: string = injected?.siteUrl ?? import.meta.env.VITE_CONVEX_SITE_URL ?? location.origin;
export const LLM_AVAILABLE: boolean = injected?.llm ?? false;
