// Only call from actions: crypto.getRandomValues is not secret in queries/mutations.
const ALPHA = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function randomString(n: number): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ALPHA[b % ALPHA.length]).join("");
}
export const newToken = (kind: "search" | "api") => `go${kind === "search" ? "s" : "a"}_${randomString(28)}`;
