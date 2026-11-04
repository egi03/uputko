import { ArrowRight } from "lucide-react";
import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";

/**
 * A link that leads on to another page of the app: „Sve ustanove, karta i tablica →” (class
 * .more). The arrow is glued to the last word by a no-break space, so a narrow column never
 * leaves it alone on a line. Inside a conversation use ExtLink (a new tab), which keeps a live
 * voice session open.
 */
export function MoreLink({ children, className, ...rest }: Omit<LinkProps, "children"> & { children: ReactNode }) {
  return (
    <Link {...rest} className={className ? `more ${className}` : "more"}>
      <span>{children}</span>
      <span className="link__tail" aria-hidden="true">
        {"\u00a0"}
        <ArrowRight />
      </span>
    </Link>
  );
}
