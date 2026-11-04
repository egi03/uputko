import { useEffect, useState } from "react";

function rootPx(): number {
  return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 18;
}

/**
 * The root font size in CSS pixels: 18, 21 or 24 for A, A+ and A++ (more when the browser's own
 * default is larger). Text inside charts and maps is sized from it (axis labels 0.78 × root,
 * notes 0.83 × root), so graphics follow the text-size setting. It updates when „Prikaz” changes
 * the size (data-text on <html>).
 */
export function useRootFontSize(): number {
  const [px, setPx] = useState(rootPx);
  useEffect(() => {
    const update = () => setPx(rootPx());
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-text"] });
    update();
    return () => observer.disconnect();
  }, []);
  return px;
}
