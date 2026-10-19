import sharp from "sharp";

export interface TextImageOptions {
  readonly text: string;
  /** Pango font description, such as `"Geist 12"`. */
  readonly font: string;
  /**
   * Font file that provides the font, so the text renders where the system
   * has no fonts installed.
   */
  readonly fontfile?: string;
  readonly color?: string;
  readonly width?: number;
  readonly align?: "left" | "centre" | "center" | "right";
}

/** Renders text into a tightly cropped transparent PNG. */
export const renderTextImage = (options: TextImageOptions) =>
  sharp({
    text: {
      text: options.color
        ? `<span foreground="${options.color}">${escapePangoText(options.text)}</span>`
        : escapePangoText(options.text),
      font: options.font,
      fontfile: options.fontfile,
      width: options.width,
      align: options.align,
      rgba: true,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });

const escapePangoText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
