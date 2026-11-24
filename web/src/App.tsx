import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSession } from "./store";
import { linkProps, useLocation } from "./router";
import { Logo } from "./ui";
import { Landing } from "./pages/Landing";
import { Home } from "./pages/Home";
import { Editor } from "./pages/Editor";
import { Info } from "./pages/Info";
import { Settings } from "./pages/Settings";
import { Welcome } from "./pages/Welcome";
import { Team } from "./pages/Team";

export function App() {
  const session = useSession();
  const { path } = useLocation();
  const me = useQuery(api.users.me, session ? { token: session.apiToken } : "skip");

  if (!session || me === null) return <Landing signedOutReason={me === null ? "That token no longer works. Sign in again." : undefined} />;

  let page;
  if (path === "/" || path === "") page = <Home />;
  else if (path === "/new") page = <Editor />;
  else if (path.startsWith("/i/")) page = <Info keyword={decodeURIComponent(path.slice(3))} />;
  else if (path === "/settings") page = <Settings />;
  else if (path === "/welcome") page = <Welcome />;
  else if (path.startsWith("/team/")) page = <Team slug={decodeURIComponent(path.slice(6))} />;
  else page = <NotFound />;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="logo" {...linkProps("/")}>
          <Logo />
        </a>
        <nav>
          <a className={path === "/" ? "on" : ""} {...linkProps("/")}>Shortcuts</a>
          <a className={path === "/new" ? "on" : ""} {...linkProps("/new")}>New</a>
          <a className={path === "/settings" ? "on" : ""} {...linkProps("/settings")}>Settings</a>
        </nav>
        <div className="spacer" />
        <span className="faint" style={{ fontSize: 13.5 }}>{me?.name ?? ""}</span>
      </header>
      {page}
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty fade-in" style={{ paddingTop: 120 }}>
      <h1 className="title">Nothing <em>here</em>.</h1>
      <a className="btn" {...linkProps("/")}>Back to shortcuts</a>
    </div>
  );
}
