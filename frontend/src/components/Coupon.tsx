import { Mail } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";

import { fmt, NBSP, nbspHr, plural, slotLongHr, stampHr } from "../format";
import type { WaitOption } from "../types";
import { ROLE_LABELS, couponOptions, instKey, roleLabel, waitTone } from "../waiting";
import { SEP, kmWords, waitPhrase, waitWord } from "./cards/answers";
import { ExtLink } from "./ExtLink";
import { TelLink } from "./TelLink";
import { Typeset } from "./Typeset";

type HeadingLevel = 2 | 3 | 4 | 5;

type CouponProps = Omit<ComponentPropsWithoutRef<"article">, "children"> & {
  option: WaitOption;
  /** The role in words; defaults to the option's role („Najbliže vama”). */
  label?: string;
  /** The Croatian median for the procedure: colours the number (shorter, about, longer). */
  median?: number | null;
  /** The institution's name is a heading of this level (3 under a page headline, 4 in an answer). */
  headingLevel?: HeadingLevel;
  /** What this appointment saves against the nearest one („58 dana ranije”). */
  saving?: number;
};

/**
 * One first free appointment as a ticket: the wait as a big number on the
 * left, teal when shorter than the Croatian median and red when longer (the number is always
 * there, so the colour never stands alone); on the right the role, the institution, where it is,
 * the date of the first slot and the phone as a button. Standing alone it is a card; inside an
 * answer it is one of the answer's rows. Everything a screen reader needs is in the label
 * („Najbliže vama: Opća županijska bolnica Vinkovci, za 69 dana”) and in the text.
 */
function Coupon({
  option,
  label,
  median = null,
  headingLevel = 3,
  saving,
  className,
  ...rest
}: CouponProps) {
  const role = label ?? ROLE_LABELS[option.role];
  const wait = option.wait_days;
  const word = waitWord(wait);
  const size = word ? " coupon__days--word" : wait >= 1000 ? " coupon__days--l4" : wait >= 100 ? " coupon__days--l3" : "";
  const name = option.spoken_name;
  const where = [option.settlement, kmWords(option.distance_km)].filter(Boolean).join(SEP);
  const Name = `h${headingLevel}` as const;
  const email = option.email;
  const web = !option.phone && !email && option.web ? option.web : null;
  return (
    <article
      {...rest}
      className={[`coupon`, saving ? "coupon--sooner" : "", className ?? ""].filter(Boolean).join(" ")}
      data-inst={instKey(option)}
      aria-label={`${role ? `${role}: ` : ""}${name}, ${waitPhrase(wait)}${saving ? `, ${savingWords(saving)}` : ""}`}
    >
      <p className={`coupon__days coupon__days--${waitTone(wait, median)}${size}`} aria-hidden="true">
        <span className="coupon__num">{word ?? fmt(wait)}</span>
        {word ? null : <span className="coupon__unit">{plural(wait, "dan", "dana", "dana")}</span>}
      </p>
      <div className="coupon__body">
        {role ? <p className="coupon__role">{nbspHr(role)}</p> : null}
        {saving ? (
          <p className="coupon__saving" aria-hidden="true">
            {savingWords(saving)}
          </p>
        ) : null}
        <Name className="coupon__name">
          <Typeset text={name} />
        </Name>
        {where ? <p className="coupon__where">{where}</p> : null}
        <p className="coupon__when">
          <span className="visually-hidden">Prvi slobodni termin {waitPhrase(wait)}: </span>
          {slotLongHr(option.first_slot)}
        </p>
        {option.phone || email || web ? (
          <p className="coupon__acts">
            <TelLink raw={option.phone} name={name} icon className="coupon__tel" />
            {email ? (
              <a className="coupon__mail" href={`mailto:${email}`}>
                <Mail aria-hidden="true" />
                <span className="coupon__mail-w">E-pošta</span>
                <span className="coupon__addr"> {email}</span>
              </a>
            ) : null}
            {web ? (
              <ExtLink className="coupon__web" href={web.startsWith("http") ? web : `https://${web}`}>
                Mrežna stranica
              </ExtLink>
            ) : null}
          </p>
        ) : null}
        {option.list_updated_at ? (
          <p className="coupon__receipt">Lista ustanove od {stampHr(option.list_updated_at)}</p>
        ) : null}
      </div>
    </article>
  );
}

/** „58 dana ranije”: the days an appointment saves against the nearest one. */
function savingWords(n: number): string {
  return `${fmt(n)}${NBSP}${plural(n, "dan", "dana", "dana")} ranije`;
}

/**
 * The tickets of an answer: the nearest, a sooner one nearby and the soonest in Croatia (at most
 * three; other options are rows or table lines). Side by side where they fit, stacked in a
 * narrow column; each one rises in gently when it arrives. A sooner one says what it saves.
 */
export function Coupons({
  options,
  entries,
  median = null,
  headingLevel = 3,
  label = "Predloženi termini",
  className,
}: {
  options: WaitOption[];
  /** Every option with a free slot (for „Puno ranije, dalje od vas”); defaults to `options`. */
  entries?: WaitOption[];
  median?: number | null;
  headingLevel?: HeadingLevel;
  label?: string;
  className?: string;
}) {
  const shown = couponOptions(options);
  if (!shown.length) return null;
  const nearest = shown.find((o) => o.role === "nearest");
  return (
    <ul className={className ? `coupons ${className}` : "coupons"} aria-label={label}>
      {shown.map((o) => (
        <li key={`${instKey(o)}-${o.role}`}>
          <Coupon
            option={o}
            label={roleLabel(o, entries ?? options)}
            median={median}
            headingLevel={headingLevel}
            saving={nearest && o !== nearest && o.wait_days < nearest.wait_days ? nearest.wait_days - o.wait_days : undefined}
          />
        </li>
      ))}
    </ul>
  );
}
