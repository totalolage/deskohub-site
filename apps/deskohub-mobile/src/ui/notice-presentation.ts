export type NoticeTone = "info" | "warning" | "error";

/**
 * How a notice presents its message: `error` interrupts (`alert`), `info`
 * and `warning` wait their turn (`status`). Without a message the live region
 * stays mounted, so assistive tech announces the next one, but takes no
 * layout space.
 */
export const noticePresentation = (
  tone: NoticeTone,
  message: string | undefined
) => {
  const alert = tone === "error";
  return {
    shown: message !== undefined && message !== "",
    role: alert ? "alert" : "status",
    live: alert ? "assertive" : "polite",
    glyph: tone === "info" ? "i" : "!",
  } as const;
};

/**
 * An idle live region's layout: absolutely positioned, so it leaves the
 * parent's flow and its `gap`, which still applies between zero-size
 * children, and clipped to a point so its empty line draws nothing.
 */
export const idleLiveRegionLayout = {
  height: 1,
  overflow: "hidden",
  position: "absolute",
  width: 1,
} as const;
