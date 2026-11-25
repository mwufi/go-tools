import { useEffect, useRef } from "react";

/** The "Save to go" bookmarklet: drag it to the bookmarks bar, click it on any page. */
export function bookmarkletCode(origin: string) {
  return `javascript:(()=>{window.open(${JSON.stringify(origin + "/new?u=")}+encodeURIComponent(location.href)+"&d="+encodeURIComponent(document.title),"_blank")})()`;
}

export function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  // React refuses javascript: URLs in href, so set it on the element directly.
  useEffect(() => ref.current?.setAttribute("href", bookmarkletCode(location.origin)), []);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
      <a ref={ref} className="bookmarklet" onClick={(e) => e.preventDefault()} title="Drag me to your bookmarks bar">
        + Save to go
      </a>
      <span className="hint">Drag this to your bookmarks bar. On any page, click it to make a shortcut for that page.</span>
    </div>
  );
}
