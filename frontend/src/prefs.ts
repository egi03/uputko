import { createContext, use, useEffect, useState } from "react";

export interface Prefs {
  text: "normal" | "large" | "xlarge";
  contrast: "normal" | "high";
  theme: "auto" | "light" | "dark";
  /** "auto" follows the device (prefers-reduced-motion), as the theme's "Kao uređaj" does. */
  motion: "auto" | "full" | "reduce";
}

export const DEFAULTS: Prefs = { text: "normal", contrast: "normal", theme: "auto", motion: "auto" };
const KEY = "uputko-prikaz";
/** The key before the project was named Uputko everywhere; read once, then saved under KEY. */
const OLD_KEY = "halo-prikaz";
/** The shape of the saved preferences; older ones are read through load()'s migration. */
const VERSION = 2;

const CHOICES: { readonly [K in keyof Prefs]: readonly Prefs[K][] } = {
  text: ["normal", "large", "xlarge"],
  contrast: ["normal", "high"],
  theme: ["auto", "light", "dark"],
  motion: ["auto", "full", "reduce"],
};

/** A saved value where it is one of the choices; the default for anything else (edited by hand). */
function choice<K extends keyof Prefs>(key: K, value: unknown): Prefs[K] {
  return CHOICES[key].find((c) => c === value) ?? DEFAULTS[key];
}

export function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY);
    if (!raw) return DEFAULTS;
    const { v, ...saved } = JSON.parse(raw) as Partial<Record<keyof Prefs, unknown>> & { v?: number };
    // Before version 2 the motion choice had no "auto": every visitor saved "full", the default,
    // which still followed a device that asks for less motion. That is "auto" now; "full" only
    // means what it says once it has been chosen on the new sheet.
    const motion = v === VERSION ? saved.motion : saved.motion === "reduce" ? "reduce" : "auto";
    return {
      text: choice("text", saved.text),
      contrast: choice("contrast", saved.contrast),
      theme: choice("theme", saved.theme),
      motion: choice("motion", motion),
    };
  } catch {
    return DEFAULTS;
  }
}

export function save(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...p, v: VERSION }));
  } catch {
    // storage can be blocked; preferences still apply for this visit
  }
}

// At this width and below the navigation moves to the tab bar at the bottom, at every text size
//: the same switch as the CSS media query (max-width: 760px). Above it the
// five links of the top bar fit on one line (measured at each text size).
const NAV_BREAKPOINT: Record<Prefs["text"], number> = { normal: 1030, large: 1235, xlarge: 1370 };

export function applyNav(text: Prefs["text"]) {
  document.documentElement.dataset.nav = window.innerWidth <= NAV_BREAKPOINT[text] ? "compact" : "full";
}

// The paper of each theme (styles/tokens.css): the phone's browser bar takes the page's colour.
const PAPER = { light: "#FFFFFF", dark: "#0F1012" } as const;
const PAPER_HIGH = { light: "#FFFFFF", dark: "#000000" } as const;

/**
 * index.html names a bar colour for a light and a dark OS. A theme chosen here, or high
 * contrast, would leave the bar in the wrong paper: both entries follow the choice.
 */
function applyThemeColor(p: Prefs) {
  const paper = p.contrast === "high" ? PAPER_HIGH : PAPER;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    const scheme = p.theme === "auto" ? (meta.media.includes("dark") ? "dark" : "light") : p.theme;
    meta.content = paper[scheme];
  }
}

/** Applies preferences as data attributes on <html> (see styles/tokens.css). */
export function apply(p: Prefs = load()) {
  const root = document.documentElement;
  applyNav(p.text);
  root.dataset.text = p.text;
  root.dataset.contrast = p.contrast;
  root.dataset.motion = p.motion;
  if (p.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = p.theme;
  applyThemeColor(p);
}

export interface PrefsValue {
  prefs: Prefs;
  set: <K extends keyof Prefs>(key: K, value: Prefs[K]) => void;
  reset: () => void;
}

export const PrefsContext = createContext<PrefsValue | null>(null);

export function usePrefs(): PrefsValue {
  const ctx = use(PrefsContext);
  if (!ctx) throw new Error("usePrefs outside PrefsProvider");
  return ctx;
}

/**
 * True when animations should be minimal: "Smanjene", or "Kao uređaj" on a device that asks for
 * less motion. "Uključene" is the visitor's own choice and overrides the device (base.css agrees).
 */
export function useReducedMotion(): boolean {
  const { prefs } = usePrefs();
  const [os, setOs] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setOs(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return prefs.motion === "reduce" || (prefs.motion === "auto" && os);
}
