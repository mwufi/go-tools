import { linkProps } from "../router";
import { Arrow, IllusArrive } from "../ui";
import { BrowserSetup } from "./BrowserSetup";

export function Welcome() {
  return (
    <div className="fade-in" style={{ marginTop: 56 }}>
      <IllusArrive size={72} />
      <h1 className="title" style={{ marginTop: 16 }}>You're in. <em>One</em> step left.</h1>
      <p className="muted" style={{ maxWidth: 560 }}>
        Point your browser's search at this address. It has your private token in it, so keep it to yourself. Then type <code>my prs</code> in the address bar.
      </p>
      <div style={{ marginTop: 32 }}>
        <BrowserSetup />
      </div>
      <div style={{ marginTop: 32 }}>
        <a className="btn primary" {...linkProps("/")}>Done, show my shortcuts <Arrow /></a>
      </div>
    </div>
  );
}
