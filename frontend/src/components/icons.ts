/**
 * Our own pictograms for the phone tab bar, drawn on lucide's 24 grid with the stroke of the
 * page's rules: a house, a coupon with its perforation, a capsule, a microphone, three columns on
 * a baseline, and "i" in a circle. Path data, rendered as <svg class="ico">.
 */
export const TAB_ICONS = {
  home: ["M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1Z"],
  mic: ["M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z", "M18.5 11a6.5 6.5 0 0 1-13 0", "M12 17.5V21"],
  coupon: [
    "M3 9.5V7.8c0-.4.4-.8.8-.8h16.4c.4 0 .8.4.8.8v1.7a2.5 2.5 0 0 0 0 5v1.7c0 .4-.4.8-.8.8H3.8c-.4 0-.8-.4-.8-.8v-1.7a2.5 2.5 0 0 0 0-5Z",
    "M9 7.5v1.2M9 11v1.2M9 14.5v1.2",
  ],
  capsule: ["m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z", "m8.5 8.5 7 7"],
  columns: ["M4 20h16", "M7 16.5V11", "M12 16.5V5.5", "M17 16.5V8.5"],
  info: ["M3 12a9 9 0 1 0 18 0a9 9 0 1 0-18 0", "M12 16.5v-5", "M12 7.6v.01"],
} as const satisfies Record<string, readonly string[]>;

export type TabIconName = keyof typeof TAB_ICONS;
