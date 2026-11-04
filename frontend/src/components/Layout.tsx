import { Phone } from "lucide-react";
import { useEffect, useRef } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";

import { DisplaySettings } from "./DisplaySettings";
import { ErrorBoundary } from "./ErrorBoundary";
import { TAB_ICONS, type TabIconName } from "./icons";
import { Ac } from "./Typeset";

const SHY = "­";

// The three things a visitor comes for: a shorter wait, a medicine, the
// assistant; then the pages for municipalities and about the project. Each page has one name
// (the top bar, the page's title and headline); `short` is the same name cut to one word for the
// tab bar, where „Liste čekanja” and „O projektu” would take two lines. A soft hyphen marks where
// a word may break when it no longer fits its tab (A++ on a small phone): „Asi-stent”, never
// „Asisten-t”. The tab bar has room for five: „Za općine” stays in the top bar and the footer.
const NAV: { to: string; label: string; short: string; icon: TabIconName; end?: boolean; tab: boolean }[] = [
  { to: "/", label: "Početna", short: `Po${SHY}četna`, icon: "home", end: true, tab: true },
  { to: "/termini", label: "Liste čekanja", short: `Li${SHY}ste`, icon: "coupon", tab: true },
  { to: "/lijekovi", label: "Lijekovi", short: `Lije${SHY}kovi`, icon: "capsule", tab: true },
  { to: "/asistent", label: "AI asistent", short: `Asi${SHY}stent`, icon: "mic", tab: true },
  { to: "/dashboard", label: "Za općine", short: `Op${SHY}ćine`, icon: "columns", tab: false },
  { to: "/o-projektu", label: "O projektu", short: `Pro${SHY}jekt`, icon: "info", tab: true },
];

export function Layout() {
  const { pathname, hash } = useLocation();
  const shown = useRef<string | null>(null);
  const following = useRef<(() => void) | undefined>(undefined);
  const front = pathname === "/";

  // After navigation, focus moves to the new page's content (screen readers, keyboards) and the
  // page starts at its top. A link that names a section lands on it, view and focus alike, even
  // on the first load (followSection); a first load without one is left alone.
  useEffect(() => {
    const here = pathname + hash;
    if (shown.current === here) return;
    const first = shown.current === null;
    shown.current = here;
    following.current?.();
    following.current = hash ? followSection(sectionId(hash)) : undefined;
    if (first) return;
    document.getElementById("main")?.focus({ preventScroll: true });
    if (!hash) window.scrollTo({ top: 0, behavior: "instant" });
  }, [pathname, hash]);

  return (
    <div className="app">
      <a className="skip-link" href="#main">
        Preskoči na sadržaj
      </a>
      <Masthead front={front} />

      <main id="main" className="main" tabIndex={-1}>
        <div className="wrap">
          <ErrorBoundary key={pathname}>
            <Outlet />
          </ErrorBoundary>
        </div>
      </main>

      <Footer />

      <nav className="tabbar" aria-label="Glavna navigacija (mobilna)">
        {NAV.filter((n) => n.tab).map(({ to, short, icon, end }) => (
          <NavLink key={to} to={to} end={end}>
            <svg className="ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
              {TAB_ICONS[icon].map((d) => (
                <path key={d} d={d} />
              ))}
            </svg>
            {/* The name is the label as seen (WCAG 2.5.3); the browser would keep the soft
                hyphens in it, so screen readers get the same word without them. */}
            <span aria-hidden="true">{short}</span>
            <span className="visually-hidden">{short.replaceAll(SHY, "")}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

/**
 * The mark: a long wait and a short one, as two bars in a rounded square (the product's one
 * promise: the same examination, a shorter wait), then the name.
 */
function Wordmark() {
  return (
    <span className="wordmark">
      <svg className="wordmark__mark" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect className="mark__bg" width="32" height="32" rx="8" />
        <rect className="mark__long" x="7" y="10.5" width="18" height="4" rx="2" />
        <rect className="mark__short" x="7" y="17.5" width="8" height="4" rx="2" />
      </svg>
      Uputko
    </span>
  );
}

/** The top bar: the wordmark home, a few links, „Prikaz” and 112. */
function Masthead({ front }: { front: boolean }) {
  return (
    <header className={front ? "top top--front" : "top"}>
      <div className="wrap top__in">
        <Link to="/" className="top__home" aria-label="Uputko, početna">
          <Wordmark />
        </Link>
        <nav className="nav" aria-label="Glavna navigacija">
          {NAV.slice(1).map(({ to, label }) => (
            <NavLink key={to} to={to}>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="top__tools">
          <DisplaySettings />
          <a className="sos" href="tel:112" aria-label="Hitni slučaj: nazovite 112">
            <Phone aria-hidden="true" />
            112
          </a>
        </div>
      </div>
    </header>
  );
}

/** The footer: name, datathon, sources, the emergency numbers and the way to the method. */
function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot__in">
        <p className="foot__brand">
          <Wordmark />
        </p>
        <p className="foot__mid">
          Datathon Portala otvorenih podataka 2026 · <span className="nw">FERIT Osijek</span>
        </p>
        <p className="foot__src">
          Podaci: <Ac>HZZO</Ac>, <Ac>CEZIH</Ac>, <Ac>HALMED</Ac>, <Ac>DZS</Ac>, data.gov.hr
        </p>
        <p className="foot__links">
          <span className="foot__dup">
            <Link to="/termini">Liste čekanja</Link> · <Link to="/lijekovi">Lijekovi</Link> ·{" "}
            <Link to="/asistent">AI asistent</Link> ·{" "}
          </span>
          <Link to="/dashboard">Za općine</Link> ·{" "}
          <Link to="/o-projektu#pristupacnost">Pristupačnost</Link>
        </p>
        <p className="foot__fine">
          <a href="tel:112">Hitno 112</a> · <a href="tel:194">Hitna medicinska pomoć 194</a> · Prototip, nije
          služba države ni <Ac end="a">HZZO</Ac>. Ne daje medicinske savjete ni dijagnoze. ·{" "}
          <Link to="/privatnost">Privatnost</Link> · <Link to="/o-projektu#izvori">Izvori</Link>
        </p>
      </div>
    </footer>
  );
}

function sectionId(hash: string): string {
  try {
    return decodeURIComponent(hash.slice(1));
  } catch {
    return hash.slice(1);
  }
}

const VISITOR_INPUT = ["wheel", "touchstart", "pointerdown", "keydown"] as const;

/**
 * Pages load their data after navigation, so the section a link names appears later and moves
 * as the content above it arrives. Land on it when it appears and keep it in view for a few
 * seconds, until the visitor scrolls or clicks on their own. Focus lands on it too, once, when it
 * first appears: the next Tab goes on from the section and a screen reader reads on from it, not
 * from the top of the page (the page itself marks nothing: base.css, [tabindex="-1"]).
 */
function followSection(id: string): () => void {
  const main = document.getElementById("main");
  if (!main) return () => undefined;
  let focused = false;
  const land = () => {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: "instant" });
    if (focused) return;
    focused = true;
    if (target.tabIndex < 0 && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
    target.focus({ preventScroll: true });
  };
  const resized = new ResizeObserver(land);
  const stop = () => {
    resized.disconnect();
    window.clearTimeout(timer);
    for (const type of VISITOR_INPUT) window.removeEventListener(type, stop);
  };
  const timer = window.setTimeout(stop, 4000);
  for (const type of VISITOR_INPUT) window.addEventListener(type, stop, { passive: true });
  resized.observe(main);
  return stop;
}
