import { HALMED, brandOf, dispensingOf, euroRange, kindWord, listSummary, listWord, marketOf, unavailable } from "../../drugs";
import { NBSP, capitalize, plural } from "../../format";
import type { DrugData, DrugProduct } from "../../types";
import { ListBalls, ListBand, MarketNote } from "../DrugStatus";
import { ExtLink } from "../ExtLink";
import { Typeset } from "../Typeset";
import { AnswerFigure, type HeadingLevel } from "./AnswerFigure";
import { type AnswerProps, SEP, answerSource, drugProducts, drugSource } from "./answers";

/** Forms listed in the conversation; the rest are one link away. */
const FORMS_SHOWN = 6;

const unique = <T,>(values: (T | null | undefined | "")[]): T[] => [...new Set(values.filter((v): v is T => !!v))];

/**
 * A medicine as one card: the name big, the active substance and the
 * prescription under it, the co-payment as the big number, the HZZO list with its Harvey ball in
 * one line, the forms as rows (each with its ball and a word), the HALMED leaflet, and the source.
 */
function DrugEntry({
  data,
  products,
  n,
  updatedAt,
  summary,
  allFormsHref,
  headingLevel = 2,
}: {
  data: Partial<DrugData>;
  products: DrugProduct[];
  /** The answer's number in a conversation (id „odgovor-n”). */
  n?: number;
  updatedAt?: string | null;
  /** The spoken summary, when the page does not show it elsewhere. */
  summary?: string;
  /** „Svi oblici ↗”: the medicine's page, in a new tab (the conversation stays open). */
  allFormsHref?: string;
  headingLevel?: HeadingLevel;
}) {
  const label = data.label ?? "Lijek";
  const s = listSummary(products);
  const rx = dispensingOf(products);
  const market = marketOf(products);
  const substances = unique<string>(products.map((p) => p.active_substance));
  const total = data.products_total ?? products.length;
  const copay = euroRange(s.copayMin, s.copayMax);
  const leaflet = products.find((p) => p.detail_url)?.detail_url;
  const sub = [
    substances.join("; ") || null,
    rx.text ? `${rx.text}${rx.prescriptions.length ? ` (${rx.prescriptions.join(", ")})` : ""}` : null,
    !market.alert && market.inMarket ? `u${NBSP}prometu` : null,
  ].filter(Boolean);
  // As on the medicine's page (entryFigure): a medicine that cannot be had shows no price.
  const gone = unavailable(products);
  const figure = gone
    ? { n: "nije u prometu", text: gone }
    : (s.kind === "dll" || s.kind === "both") && copay
      ? { n: copay, text: s.kind === "both" ? "doplata za dio pakiranja" : `doplata uz${NBSP}recept` }
      : s.kind === "oll"
        ? { n: "bez doplate", text: `uz${NBSP}recept`, tone: "free" as const }
        : null;
  const shown = products.slice(0, FORMS_SHOWN);
  return (
    <AnswerFigure
      n={n}
      headingLevel={headingLevel}
      className="ans--drug"
      title={label}
      sub={sub.length ? <Typeset text={sub.join(SEP)} /> : null}
      figure={figure}
      source={drugSource(updatedAt, data.hzzo_lists_in_force_hr)}
    >
      {summary ? (
        <p className="ans__text">
          <Typeset text={summary} />
        </p>
      ) : null}
      <MarketNote products={products} />
      <ListBand products={products} />
      {shown.length ? (
        <ul className="ans__rows" aria-label="Oblici">
          {shown.map((p, i) => (
            <FormRow key={`${p.name}-${i}`} product={p} label={label} />
          ))}
        </ul>
      ) : null}
      {leaflet || allFormsHref ? (
        <div className="ans__foot ans__links">
          {leaflet ? <ExtLink href={leaflet}>Uputa o{NBSP}lijeku (HALMED)</ExtLink> : null}
          {allFormsHref ? (
            <ExtLink href={allFormsHref}>{total > shown.length ? `Svi oblici (${total})` : "Svi oblici"}</ExtLink>
          ) : null}
        </div>
      ) : null}
    </AnswerFigure>
  );
}

/** „5 mg tablete ↗ ……… ◐ dopunska · 1,29–1,82 €” */
function FormRow({ product: p, label }: { product: DrugProduct; label: string }) {
  const name = brandOf(p, label);
  const copay = euroRange(p.copay_min_eur, p.copay_max_eur);
  return (
    <li className="arow">
      <div className="arow__main">
        <p className="arow__name">
          {p.detail_url ? <ExtLink href={p.detail_url}>{name}</ExtLink> : name}
        </p>
      </div>
      <p className="arow__val arow__val--list">
        <ListBalls list={p.hzzo_list} />
        {NBSP}
        {listWord(p)}
        {copay ? (
          <>
            {SEP}
            <b>{copay}</b>
          </>
        ) : null}
        {p.shortage === HALMED.shortage ? (
          <>
            {SEP}
            <b className="arow__warn">nestašica</b>
          </>
        ) : null}
      </p>
    </li>
  );
}

/**
 * A question about an active substance: the medicines with that substance as rows, each with its
 * ball, how it is dispensed and its co-payment, each a link to its own page.
 */
function SubstanceAnswer({ card, n, headingLevel = 2 }: AnswerProps) {
  const d = card.data as Partial<DrugData>;
  const products = drugProducts(card);
  const label = d.label ?? "";
  const brands = new Map<string, DrugProduct[]>();
  for (const p of products) brands.set(p.brand, [...(brands.get(p.brand) ?? []), p]);
  return (
    <AnswerFigure
      n={n}
      headingLevel={headingLevel}
      className="ans--drug"
      title={capitalize(label) || "Lijekovi"}
      sub="djelatna tvar"
      figure={{ n: String(brands.size), text: `${plural(brands.size, "lijek", "lijeka", "lijekova")} s${NBSP}tom tvari` }}
      source={answerSource(card)}
    >
      <ul className="ans__rows" aria-label="Lijekovi">
        {[...brands].map(([brand, items]) => {
          const s = listSummary(items);
          const copay = s.kind === "dll" || s.kind === "both" ? euroRange(s.copayMin, s.copayMax) : null;
          const rx = dispensingOf(items).text;
          return (
            <li key={brand} className="arow">
              <div className="arow__main">
                <p className="arow__name">
                  <ExtLink href={`/lijekovi?lijek=${encodeURIComponent(brand)}`}>{brand}</ExtLink>
                </p>
                {rx ? <p className="arow__meta">{rx}</p> : null}
              </div>
              <p className="arow__val arow__val--list">
                <ListBalls kind={s.kind} />
                {NBSP}
                {kindWord(s.kind)}
                {copay ? (
                  <>
                    {SEP}
                    <b>{copay}</b>
                  </>
                ) : null}
              </p>
            </li>
          );
        })}
      </ul>
      <div className="ans__foot ans__links">
        <ExtLink href={`/lijekovi?lijek=${encodeURIComponent(label)}`}>Svi lijekovi s{NBSP}tom tvari</ExtLink>
      </div>
    </AnswerFigure>
  );
}

/** A medicine answer in the conversation: the card for a brand, the list for a substance. */
export function DrugAnswer(props: AnswerProps) {
  const { card, n, headingLevel, showSummary } = props;
  const d = card.data as Partial<DrugData>;
  if (d.query_kind === "substance") return <SubstanceAnswer {...props} />;
  return (
    <DrugEntry
      data={d}
      products={drugProducts(card)}
      n={n}
      updatedAt={card.updated_at}
      summary={showSummary ? card.summary_hr : undefined}
      headingLevel={headingLevel}
      allFormsHref={`/lijekovi?lijek=${encodeURIComponent(d.label ?? "")}`}
    />
  );
}
