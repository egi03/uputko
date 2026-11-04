import { useEffect, useState } from "react";

import { SANS } from "../measure";

/**
 * A count that goes up once the upright and the italic files of the page's font have loaded (the
 * font is variable: one file per style serves every weight). A chart that measures its labels
 * while it renders (textWidth) depends on it, so it measures again: the first layout may have
 * used the fallback font.
 */
export function useFontEpoch(): number {
  const [epoch, setEpoch] = useState(0);
  useEffect(() => {
    let live = true;
    Promise.all([document.fonts.load(`700 16px ${SANS}`), document.fonts.load(`italic 400 16px ${SANS}`)])
      .then(() => {
        if (live) setEpoch((n) => n + 1);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return epoch;
}
