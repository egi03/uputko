import { type RefObject, useLayoutEffect, useState } from "react";

/** Width of an element in CSS pixels, measured before paint and on resize (charts drawn in
 * pixels stay legible at every size). */
export function useElementWidth(ref: RefObject<HTMLElement | null>, fallback = 320): number {
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(Math.round(el.getBoundingClientRect().width) || fallback);
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.round(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, fallback]);
  return width;
}
