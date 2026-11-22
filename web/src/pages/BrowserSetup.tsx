import { SITE_URL } from "../config";
import { searchUrlFor, useSession } from "../store";
import { CopyField } from "../ui";

export function BrowserSetup() {
  const session = useSession();
  const url = searchUrlFor(SITE_URL, session?.searchToken);
  return (
    <div className="form-grid">
      {!session?.searchToken && (
        <p className="hint" style={{ margin: 0 }}>
          This browser doesn't have your search token. Make a new one under <a href="#tokens">Tokens</a> and it will appear here.
        </p>
      )}
      <CopyField value={url} label="Copy URL" />
      <div className="browsers">
        <div className="card">
          <b>Chrome, Arc, Brave</b>
          Settings → Search engine → Manage search engines → Add. Name it <code>go</code>, paste the URL, then choose <i>Make default</i>.
        </div>
        <div className="card">
          <b>Firefox</b>
          Settings → Search → Search Shortcuts → Add. Paste the URL, then pick <code>go</code> as the default search engine above.
        </div>
        <div className="card">
          <b>Safari</b>
          Safari only allows built-in engines. Use the <code>go</code> keyword in Chrome or Firefox, or a redirect extension.
        </div>
      </div>
      <p className="hint" style={{ margin: 0 }}>
        Address-bar suggestions: add <code>{`${SITE_URL}/suggest?q=%s${session?.searchToken ? `&t=${session.searchToken}` : ""}`}</code> as the suggestions URL where your browser allows it.
      </p>
    </div>
  );
}
