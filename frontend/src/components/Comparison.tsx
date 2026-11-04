import type { CSSProperties } from "react";

import { fmt, NBSP, plural } from "../format";
import type { WaitOption } from "../types";
import { SEP, kmWords, waitWord } from "./cards/answers";
import { Typeset } from "./Typeset";

/**
 * The nearest appointment against the sooner one, as two bars on one scale (the front page's
 * example): the long one in the colour of „longer than the median”, the short one in teal. The
 * words carry everything; the bars only show it at a glance.
 */
export function Comparison({
  nearest,
  sooner,
  soonerLabel = "Ranije u blizini",
}: {
  nearest: WaitOption;
  sooner: WaitOption;
  soonerLabel?: string;
}) {
  const max = Math.max(nearest.wait_days, sooner.wait_days, 1);
  return (
    <ul className="cmp">
      <Row label="Najbliže" option={nearest} max={max} tone="long" />
      <Row label={soonerLabel} option={sooner} max={max} tone="short" />
    </ul>
  );
}

function Row({
  label,
  option,
  max,
  tone,
}: {
  label: string;
  option: WaitOption;
  max: number;
  tone: "long" | "short";
}) {
  const word = waitWord(option.wait_days);
  // The example is someone else's place, not the reader's: „u mjestu”, never „u vašem mjestu”.
  const km = option.distance_km !== null && option.distance_km < 2 ? `u${NBSP}mjestu` : kmWords(option.distance_km);
  const where = [option.settlement, km].filter(Boolean).join(SEP);
  const width = `${Math.max(1.5, (option.wait_days / max) * 100)}%`;
  return (
    <li className={`cmp__row cmp__row--${tone}`}>
      <p className="cmp__who">
        <span className="cmp__label">{label}</span>
        <span className="cmp__name">
          <Typeset text={option.spoken_name} />
        </span>
        {where ? <span className="cmp__where">{where}</span> : null}
      </p>
      <p className="cmp__days">
        <b className="num">{word ?? fmt(option.wait_days)}</b>
        {word ? null : `${NBSP}${plural(option.wait_days, "dan", "dana", "dana")}`}
      </p>
      <span className="cmp__track" aria-hidden="true">
        <span className="cmp__bar" style={{ "--w": width } as CSSProperties} />
      </span>
    </li>
  );
}
