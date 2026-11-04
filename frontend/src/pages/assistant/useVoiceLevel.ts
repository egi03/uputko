import { useEffect } from "react";

/** The microphone's and the agent's level as the voice SDK reads them (0 to 1). */
interface Levels {
  getInputVolume: () => number;
  getOutputVolume: () => number;
}

/**
 * The voice indicator and the booth's voice rule follow the real level: the microphone while
 * listening, the agent while speaking (--level, 0 to 1, on .voice and on the booth).
 */
export function useVoiceLevel(
  indicator: HTMLElement | null,
  booth: HTMLElement | null,
  {
    voice,
    isSpeaking,
    reduced,
    controls,
    previewVoice,
  }: {
    /** A voice conversation is connected. */
    voice: boolean;
    isSpeaking: boolean;
    reduced: boolean;
    controls: Levels;
    /** The development preview of a live voice booth (a fixed level, no microphone). */
    previewVoice: boolean;
  },
) {
  useEffect(() => {
    if (!indicator) return;
    const targets = booth ? [indicator, booth] : [indicator];
    const level = (value: string) => {
      for (const el of targets) el.style.setProperty("--level", value);
    };
    if (previewVoice && !reduced) {
      // Development preview of a live booth: a fixed level instead of a microphone.
      level("0.62");
      indicator.setAttribute("data-voice", "live");
      return () => indicator.removeAttribute("data-voice");
    }
    if (!voice || reduced) {
      level("0");
      return;
    }
    let frame = 0;
    const tick = () => {
      try {
        const raw = isSpeaking ? controls.getOutputVolume() : controls.getInputVolume();
        level(Math.min(1, Math.sqrt(Math.max(0, raw)) * 1.5).toFixed(3));
      } catch {
        level("0");
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    indicator.setAttribute("data-voice", "live"); // the level is real: the rings follow it (styles/assistant.css)
    return () => {
      cancelAnimationFrame(frame);
      indicator.removeAttribute("data-voice");
    };
  }, [indicator, booth, voice, isSpeaking, reduced, controls, previewVoice]);
}
