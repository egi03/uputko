import { Phone } from "lucide-react";

import { phoneParts } from "../format";

/**
 * A telephone number from a source as the action it is: shown the way people read it
 * ("032 349 214"), dialled in full (tel:+38532349214), and announced to screen readers as
 * „Nazovi {ustanova}: …”. A number the format does not recognise is shown as the source wrote it,
 * without a link; no number, nothing.
 */
export function TelLink({
  raw,
  name,
  icon = false,
  className,
}: {
  raw: string | null | undefined;
  /** Who answers: read before the number („Nazovi Opća županijska bolnica Vinkovci: …”). */
  name?: string;
  /** The handset in front of the number (the coupon's main action). */
  icon?: boolean;
  className?: string;
}) {
  const phone = phoneParts(raw);
  const classes = className ? `tel ${className}` : "tel";
  if (!phone) return raw?.trim() ? <span className={classes}>{raw.trim()}</span> : null;
  return (
    <a href={phone.href} className={classes}>
      {icon ? <Phone aria-hidden="true" /> : null}
      <span>
        {name ? <span className="visually-hidden">Nazovi {name}: </span> : null}
        {phone.national}
      </span>
    </a>
  );
}
