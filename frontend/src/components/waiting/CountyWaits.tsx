import { type CSSProperties, Fragment, type ReactNode, useCallback, useId, useState } from "react";

import { days, NBSP, plural } from "../../format";
import type { CountyWait, WaitingCounties } from "../../types";
import { CountyMap, type CountyValue, type MapMark } from "../CountyMap";
import { Ac } from "../Typeset";

/** The diverging scale of the map: county median against the Croatian median. */
const STEPS = [
  { key: "n2", legend: "upola kraće", words: "upola kraće ili manje", vs: "barem upola kraće od Hrvatske", test: (r: number) => r <= 0.5 },
  { key: "n1", legend: "kraće", words: "kraće", vs: "kraće od Hrvatske", test: (r: number) => r <= 0.85 },
  { key: "0", legend: "oko medijana", words: "oko medijana", vs: "oko hrvatskog medijana", test: (r: number) => r < 1.15 },
  { key: "p1", legend: "dulje", words: "dulje", vs: "dulje od Hrvatske", test: (r: number) => r < 1.6 },
  { key: "p2", legend: "znatno dulje", words: "znatno dulje", vs: "znatno dulje od Hrvatske", test: () => true },
] as const;
type Step = (typeof STEPS)[number];

function step(median: number, national: number): Step {
  const r = national > 0 ? median / national : median > 0 ? 2 : 1;
  return STEPS.find((s) => s.test(r)) ?? STEPS[2];
}

/** The shortest wait in the county, only when it says more than the median (one list: it is the median). */
function shortest(c: CountyWait): number | null {
  return c.min_days !== null && c.median_days !== null && c.min_days < c.median_days ? c.min_days : null;
}

/** „Vukovarsko-srijemska (vaša županija): medijan 81 dan, kraće od Hrvatske. Najkraće 69 dana.” */
function readout(c: CountyWait | undefined, name: string, own: boolean, national: number | null): ReactNode {
  const who = (
    <>
      <b>{name}</b>
      {own ? ` (vaša županija)` : ""}
    </>
  );
  const median = c?.median_days ?? null;
  if (!c || median === null || national === null) {
    return <>{who}: nema liste sa slobodnim terminom.</>;
  }
  const min = shortest(c);
  const lists =
    c.with_free_slot < c.institutions
      ? ` Slobodan termin ima ${c.with_free_slot} od ${c.institutions}${NBSP}${plural(c.institutions, "liste", "liste", "lista")}.`
      : "";
  return (
    <>
      {who}: medijan {days(median)}, {step(median, national).vs}.
      {min !== null ? ` Najkraće ${days(min)}.` : ""}
      {lists}
    </>
  );
}

/**
 * Median wait per county against the Croatian median for one procedure: the map with its stepped
 * legend, a status line that follows the selected county (or the user's own), and the ranked list
 * of counties, shortest first, each row a button that filters like the map, with the counties that
 * have no list with a free appointment named at the end. The page supplies the section and its
 * headline.
 */
export function CountyWaits({
  data,
  selected,
  onSelect,
  hint = "Odaberite županiju za popis njezinih ustanova.",
  originCounty = null,
  marks,
  source,
}: {
  data: WaitingCounties;
  selected: string | null;
  onSelect: (county: string | null) => void;
  hint?: string;
  /** The user's county (`location.county` of the answer): outlined and marked „(vaša)”. */
  originCounty?: string | null;
  /** The user's place and the soonest appointment, when their coordinates are known. */
  marks?: MapMark[];
  /** Where the medians come from, with the date („HZZO (CEZIH), 29. 10. 2026.”), in the credit. */
  source?: ReactNode;
}) {
  const [mapHot, setMapHot] = useState<{ county: string | null; focused: boolean }>({ county: null, focused: false });
  const onHot = useCallback((county: string | null, focused: boolean) => setMapHot({ county, focused }), []);
  // A row of the ranked list under the pointer or the keyboard: its county lights up on the map.
  const [listHot, setListHot] = useState<{ county: string | null; focused: boolean }>({ county: null, focused: false });
  // In a narrow column the ranking shows its first five rows (and your or the chosen county) until
  // „Prikaži sve županije” opens it (styles/map.css); a wide one always shows all of them.
  const [allShown, setAllShown] = useState(false);
  const idBase = useId();
  // The keyboard's county first (the marker must follow the focus), then the pointer's.
  const hot = [mapHot, listHot].find((h) => h.county && h.focused) ?? (listHot.county ? listHot : mapHot);
  const national = data.national.median_days;

  const values: Record<string, CountyValue> = {};
  for (const c of data.counties) {
    if (c.median_days === null || national === null) continue;
    const s = step(c.median_days, national);
    const min = shortest(c);
    values[c.county] = {
      fill: `var(--div-${s.key})`,
      label: `medijan ${days(c.median_days)}, ${s.words}${min !== null ? `; najkraće ${days(min)}` : ""}; ${c.with_free_slot} od ${c.institutions}${NBSP}${plural(c.institutions, "liste", "liste", "lista")} s${NBSP}terminom`,
    };
  }
  const ranked = data.counties
    .filter((c) => c.median_days !== null)
    .sort((a, b) => (a.median_days ?? 0) - (b.median_days ?? 0) || a.county.localeCompare(b.county, "hr"));
  const without = data.counties
    .filter((c) => c.median_days === null)
    .map((c) => c.county)
    .sort((a, b) => a.localeCompare(b, "hr"));
  const byName = new Map(data.counties.map((c) => [c.county, c]));
  const focus = selected ?? originCounty;
  const procedure = data.procedure.name ?? "postupak";
  // The legend step of the county under the pointer or the keyboard focus is marked too.
  const hotMedian = hot.county ? (byName.get(hot.county)?.median_days ?? null) : null;
  const hotStep = !hot.county
    ? null
    : hotMedian !== null && national !== null
      ? step(hotMedian, national).key
      : "none";
  const stepMark = (key: string) => (hotStep === key ? (hot.focused ? " is-focus" : " is-hot") : "");

  return (
    <div className="cw">
      <p className="small cw__dek">
        Medijan čekanja po županijama, u&nbsp;usporedbi s&nbsp;medijanom Hrvatske
        {national !== null ? ` (${days(national)})` : ""}.{hint ? ` ${hint}` : ""}
      </p>
      <div className="cw__body">
        <div className="cw__fig">
          <CountyMap
            values={values}
            selected={selected}
            onSelect={(c) => onSelect(c === selected ? null : c)}
            ariaLabel={`Karta županija: medijan čekanja na ${procedure} u usporedbi s medijanom Hrvatske${national !== null ? ` (${days(national)})` : ""}.`}
            emptyLabel="nema liste sa slobodnim terminom"
            origin={originCounty}
            marks={marks}
            onHot={onHot}
            hot={listHot.county}
          />
          <div className="cw__legend" aria-hidden="true">
            {STEPS.map((s) => (
              <span
                key={s.key}
                className={`cw__step${stepMark(s.key)}`}
                style={{ "--c": `var(--div-${s.key})` } as CSSProperties}
              >
                <i />
                <span>{s.legend}</span>
              </span>
            ))}
            <span className={`cw__step cw__step--none${stepMark("none")}`}>
              <i />
              <span>bez liste</span>
            </span>
          </div>
          <p className="small cw__readout" role="status">
            {focus ? (
              readout(byName.get(focus), focus, focus === originCounty, national)
            ) : (
              <>
                <b>Hrvatska</b>: medijan {national !== null ? days(national) : "nije poznat"}. Odaberite županiju na
                karti.
              </>
            )}
          </p>
          {selected ? (
            <p className="cw__reset">
              <button type="button" className="linkbtn" onClick={() => onSelect(null)}>
                Sve županije
              </button>
            </p>
          ) : null}
        </div>
        <div className="cw__list">
          {ranked.length ? (
            // Every row is a button that does what a county on the map does (a target of a row's
            // full width, for fingers and for keyboards); the map is the second way in.
            <ol
              className={allShown ? "cw__rank is-open" : "cw__rank"}
              id={`${idBase}-rank`}
              aria-label="Županije od najkraćeg medijana čekanja"
            >
              {ranked.map((c, i) => {
                const s = step(c.median_days ?? 0, national ?? 0);
                const own = c.county === originCounty;
                const cls = [
                  i >= 5 && !own && c.county !== selected ? "is-later" : "",
                  own ? "is-origin" : "",
                  c.county === selected ? "is-selected" : "",
                  c.county === mapHot.county ? (mapHot.focused ? "is-focus" : "is-hot") : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <li key={c.county} className={cls || undefined} data-county={c.county}>
                    <button
                      type="button"
                      className="cw__row"
                      aria-pressed={c.county === selected}
                      onClick={() => onSelect(c.county === selected ? null : c.county)}
                      onPointerEnter={() => setListHot({ county: c.county, focused: false })}
                      onPointerLeave={() => setListHot({ county: null, focused: false })}
                      onFocus={(e) =>
                        setListHot({ county: c.county, focused: e.currentTarget.matches(":focus-visible") })
                      }
                      onBlur={() => setListHot({ county: null, focused: false })}
                    >
                      <span
                        className="cw__sw"
                        style={{ "--sw": `var(--div-${s.key})` } as CSSProperties}
                        aria-hidden="true"
                      />
                      <span className="cw__name">
                        {c.county}
                        {own ? <em> (vaša)</em> : null}
                      </span>
                      <span className="cw__n num">{c.median_days}</span>
                      <span className="visually-hidden">
                        {" "}
                        {plural(c.median_days ?? 0, "dan", "dana", "dana")}, {s.words}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : null}
          {ranked.length > 5 ? (
            <button
              type="button"
              className="btn btn--sm cw__all"
              aria-expanded={allShown}
              aria-controls={`${idBase}-rank`}
              onClick={() => setAllShown((v) => !v)}
            >
              {allShown ? "Prikaži manje" : `Prikaži sve županije (${ranked.length})`}
            </button>
          ) : null}
          {without.length ? (
            <p className="small cw__none">
              <span className="cw__sw cw__sw--none" aria-hidden="true" />
              Bez liste sa slobodnim terminom:{" "}
              {without.map((name, i) => (
                <Fragment key={name}>
                  {i ? ", " : null}
                  <span className="nw">{name}</span>
                </Fragment>
              ))}
              .
            </p>
          ) : null}
        </div>
      </div>
      <p className="credit">
        {source ? (
          <>
            <b>Izvor:</b> {source}.{" "}
          </>
        ) : null}
        Granice županija: <Ac>DHMZ</Ac>.
      </p>
    </div>
  );
}
