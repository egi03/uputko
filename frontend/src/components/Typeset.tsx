import { Fragment, type ReactNode } from "react";

import { typesetHr } from "../format";

/**
 * An acronym as optically reduced capitals. With a case ending ("HZZO-a") the two never break
 * apart: <Ac end="a">HZZO</Ac>.
 */
export function Ac({ children, end }: { children: string; end?: string }) {
  const abbr = <abbr className="ac">{children}</abbr>;
  return end ? (
    <span className="nw">
      {abbr}-{end}
    </span>
  ) : (
    abbr
  );
}

/** Sources, institutions and procedures as they appear in source and template text. */
const ACRONYM =
  /(?<![\p{L}\d])(HZZO|CEZIH|HALMED|DZS|DHMZ|KBC|KB|OŽB|ŽB|OB|DZ|SB|PB|MR|UZV|CT|PET|RTG|EEG|EKG|EMNG|EMG|ORL|OCT|PSA|HPV|ATC|EUPL)(?:-(\p{Ll}+))?(?![\p{L}\d])/gu;

/**
 * Text from a source or a template (summary_hr, names) set the Croatian way: „quotes”,
 * non-breaking spaces after one-letter words, before units and after a qualifying acronym
 * (nbspHr), acronyms as small capitals.
 */
export function Typeset({ text }: { text: string }) {
  const value = typesetHr(text);
  const out: ReactNode[] = [];
  let at = 0;
  for (const match of value.matchAll(ACRONYM)) {
    const start = match.index;
    if (start > at) out.push(value.slice(at, start));
    out.push(
      <Fragment key={start}>
        <Ac end={match[2]}>{match[1] ?? ""}</Ac>
      </Fragment>,
    );
    at = start + match[0].length;
  }
  if (at < value.length) out.push(value.slice(at));
  return <>{out}</>;
}
