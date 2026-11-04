import { ArrowUpRight } from "lucide-react";
import type { AnchorHTMLAttributes, ReactNode } from "react";

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "target" | "rel" | "children"> & {
  href: string;
  children: ReactNode;
};

/**
 * A link that opens in a new tab: the words (one span, so an <abbr> inside never splits the link),
 * then ↗ glued to the last word by a no-break space, and for screen readers
 * „(otvara se u novoj kartici)”. Every link inside a conversation is one, so a live voice session
 * never ends because someone opened a source.
 */
export function ExtLink({ children, className, ...rest }: Props) {
  return (
    <a {...rest} className={className ? `ext ${className}` : "ext"} target="_blank" rel="noreferrer">
      <span>{children}</span>
      <span className="link__tail" aria-hidden="true">
        {"\u00a0"}
        <ArrowUpRight className="ext__ico" />
      </span>
      <span className="visually-hidden"> (otvara se u novoj kartici)</span>
    </a>
  );
}
