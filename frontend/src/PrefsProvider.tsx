import { type ReactNode, useEffect, useMemo, useState } from "react";

import { apply, applyNav, DEFAULTS, load, type Prefs, PrefsContext, type PrefsValue, save } from "./prefs";

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<Prefs>(load);

  useEffect(() => {
    const onResize = () => applyNav(prefs.text);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [prefs.text]);

  useEffect(() => {
    apply(prefs);
    save(prefs);
  }, [prefs]);

  const value = useMemo<PrefsValue>(
    () => ({
      prefs,
      set: (key, v) => setPrefs((p) => ({ ...p, [key]: v })),
      reset: () => setPrefs(DEFAULTS),
    }),
    [prefs],
  );
  return <PrefsContext value={value}>{children}</PrefsContext>;
}
