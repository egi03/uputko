import { SlidersHorizontal, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

import { type Prefs, usePrefs } from "../prefs";

interface Option<V> {
  value: V;
  label: string;
  sub?: string;
}

function Choice<K extends keyof Prefs>({
  name,
  legend,
  options,
}: {
  name: K;
  legend: string;
  options: Option<Prefs[K]>[];
}) {
  const { prefs, set } = usePrefs();
  return (
    <fieldset className="settings__group">
      <legend>{legend}</legend>
      <div className="seg seg--box">
        {options.map((o) => (
          <label key={o.value}>
            <input
              type="radio"
              name={name}
              value={o.value}
              checked={prefs[name] === o.value}
              onChange={() => set(name, o.value)}
            />
            <span>{o.label}</span>
            {o.sub ? <span className="seg__sub">{o.sub}</span> : null}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/**
 * „Prikaz”: a floating sheet with text size, contrast, theme and motion. It is not modal: Esc
 * closes it and returns to the button, and so does „Zatvori”; a click outside or focus moving on
 * past it (Tab after „Vrati zadano”) closes it and leaves focus where it went, so the sheet never
 * covers the link that has just been reached.
 */
export function DisplaySettings() {
  const { reset } = usePrefs();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const titleId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) =>
      wrap.current !== null && !wrap.current.contains(target as Node | null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onPress = (e: MouseEvent) => {
      if (outside(e.target)) setOpen(false);
    };
    // focusin, not blur: leaving the window for another app keeps the sheet open.
    const onFocus = (e: FocusEvent) => {
      if (outside(e.target)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPress);
    document.addEventListener("focusin", onFocus);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPress);
      document.removeEventListener("focusin", onFocus);
    };
  }, [open]);

  return (
    <div className="settings" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="top__btn"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal aria-hidden="true" />
        Prikaz
      </button>
      {open ? (
        <div id={panelId} className="settings__panel" role="group" aria-labelledby={titleId}>
          <div className="settings__head">
            <h2 id={titleId}>Prilagodite prikaz</h2>
            <button
              type="button"
              className="btn btn--icon"
              aria-label="Zatvori"
              onClick={() => {
                setOpen(false);
                button.current?.focus();
              }}
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <Choice
            name="text"
            legend="Veličina slova"
            options={[
              { value: "normal", label: "A", sub: "obično" },
              { value: "large", label: "A+", sub: "veće" },
              { value: "xlarge", label: "A++", sub: "najveće" },
            ]}
          />
          <Choice
            name="contrast"
            legend="Kontrast"
            options={[
              { value: "normal", label: "Obični" },
              { value: "high", label: "Visoki" },
            ]}
          />
          <Choice
            name="theme"
            legend="Tema"
            options={[
              { value: "auto", label: "Kao uređaj" },
              { value: "light", label: "Svijetla" },
              { value: "dark", label: "Tamna" },
            ]}
          />
          {/* „Kao uređaj” follows the device's reduced-motion setting, as the theme follows its
              colours; „Uključene” and „Smanjene” are the visitor's own choice and override it. */}
          <Choice
            name="motion"
            legend="Animacije"
            options={[
              { value: "auto", label: "Kao uređaj" },
              { value: "full", label: "Uključene" },
              { value: "reduce", label: "Smanjene" },
            ]}
          />
          <button type="button" className="linkbtn settings__reset" onClick={reset}>
            Vrati zadano
          </button>
        </div>
      ) : null}
    </div>
  );
}
