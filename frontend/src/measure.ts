/** The page's sans (styles/tokens.css, --font-sans) as the canvas and FontFaceSet name it. */
export const SANS = '"Schibsted Grotesk Variable", system-ui, sans-serif';

interface Face {
  weight?: number;
  italic?: boolean;
}

export const BOLD: Face = { weight: 700 };
export const ITALIC: Face = { italic: true };

let ctx: CanvasRenderingContext2D | null | undefined;

/**
 * A chart label's width in CSS px, measured in its own face, so labels keep clear of each other,
 * of the lines and of the edges at A, A+ and A++ (estimated from the length where there is no
 * canvas). Until the page's font has loaded this is the fallback's width: see useFontEpoch.
 */
export function textWidth(text: string, size: number, { weight = 400, italic = false }: Face = {}): number {
  if (ctx === undefined) ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return text.length * size * 0.56;
  ctx.font = `${italic ? "italic " : ""}${weight} ${size}px ${SANS}`;
  return ctx.measureText(text).width;
}
