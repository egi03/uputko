import { useEffect } from "react";

/**
 * Keeps a custom property on the root at an element's height while it is on the page: the sticky
 * booth and the composer, which the page scrolls focus and links clear of (styles/assistant.css).
 */
export function useHeightVar(el: HTMLElement | null, name: string) {
  useEffect(() => {
    if (!el) return;
    const root = document.documentElement;
    const observer = new ResizeObserver(() => root.style.setProperty(name, `${el.offsetHeight}px`));
    observer.observe(el, { box: "border-box" });
    return () => {
      observer.disconnect();
      root.style.removeProperty(name);
    };
  }, [el, name]);
}
