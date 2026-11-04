import { type ReactNode, useId } from "react";

import { Typeset } from "../Typeset";
import type { SourceNoteParts } from "./answers";

export type HeadingLevel = 2 | 3 | 4;

/**
 * An answer in the conversation as one clean card: a short title with an
 * optional line under it, the key number big on the right, then the rows, and the source with its
 * date in small grey at the bottom. White, 18 px corners, a hairline and a light shadow; no icons,
 * no overlines.
 *
 * `n` gives the card the id „odgovor-n” (focusable without a marker), so the conversation can
 * point at it.
 */
export function AnswerFigure({
  n,
  title,
  sub,
  figure,
  source,
  headingLevel = 2,
  className,
  children,
}: {
  n?: number;
  title: ReactNode;
  /** One short line under the title („od mjesta Vinkovci · medijan u Hrvatskoj 126 dana”). */
  sub?: ReactNode;
  /** The key number, big, and what it counts in small words under it („57” + „ordinacija u mjestu”). */
  figure?: { n: string; text: ReactNode; tone?: "free" } | null;
  /** Where the data comes from and when it was read; always shown when the answer has data. */
  source?: SourceNoteParts | null;
  headingLevel?: HeadingLevel;
  className?: string;
  children?: ReactNode;
}) {
  const hid = useId();
  const Title = `h${headingLevel}` as const;
  return (
    <figure
      className={className ? `ans ${className}` : "ans"}
      id={n ? `odgovor-${n}` : undefined}
      tabIndex={n ? -1 : undefined}
      aria-labelledby={hid}
    >
      <div className="ans__head">
        <div className="ans__titles">
          <Title className="ans__title" id={hid}>
            {title}
          </Title>
          {sub ? <p className="ans__sub">{sub}</p> : null}
        </div>
        {figure ? (
          <p className={figure.tone ? `ans__fig ans__fig--${figure.tone}` : "ans__fig"}>
            <span className="ans__n">{figure.n}</span> <span className="ans__unit">{figure.text}</span>
          </p>
        ) : null}
      </div>
      {children}
      {source ? <SourceLine parts={source} /> : null}
    </figure>
  );
}

/** The last line of a card: „Izvor: HZZO, liste čekanja (CEZIH), ažurirano 29. 10. 2026. u 17:19.” */
function SourceLine({ parts }: { parts: SourceNoteParts }) {
  return (
    <p className="ans__src">
      Izvor: <Typeset text={parts.publisher} />
      <Typeset text={parts.rest} />
    </p>
  );
}
