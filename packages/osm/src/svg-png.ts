import { Effect, Option } from "effect";
import sharp from "sharp";
import { ImageRenderingError } from "./errors";

export interface SvgPngTextOverlay {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly font: string;
  readonly fontfile?: string;
  readonly color?: string;
}

export interface SvgPngBufferOptions {
  readonly textOverlays?: readonly SvgPngTextOverlay[];
}

export const generateSvgPngBuffer = Effect.fn("osm.generateSvgPngBuffer")(
  (svg: string | Buffer, options: SvgPngBufferOptions = {}) =>
    renderSvg(svg).pipe(
      Effect.bindTo("base"),
      Effect.bind("textOverlays", () =>
        Effect.forEach(options.textOverlays ?? [], renderTextOverlay, {
          concurrency: "inherit",
        })
      ),
      Effect.bind("composite", ({ base, textOverlays }) =>
        compositeTextOverlays(base, textOverlays).pipe(
          Effect.when(Effect.succeed(textOverlays.length > 0))
        )
      ),
      Effect.map(({ base, composite }) =>
        Option.getOrElse(composite, () => base)
      )
    )
);

const renderSvg = (svg: string | Buffer) =>
  Effect.tryPromise({
    try: () =>
      sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg))
        .png()
        .toBuffer(),
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "The SVG image could not be rendered.",
        operation: "render-svg",
      }),
  });

const renderTextOverlay = (overlay: SvgPngTextOverlay) =>
  Effect.tryPromise({
    try: async (): Promise<sharp.OverlayOptions> => {
      const renderedText = await sharp({
        text: {
          text: overlay.color
            ? `<span foreground="${overlay.color}">${escapePangoText(overlay.text)}</span>`
            : escapePangoText(overlay.text),
          font: overlay.font,
          fontfile: overlay.fontfile,
          width: overlay.width,
          align: "center",
          rgba: true,
        },
      })
        .png()
        .toBuffer({ resolveWithObject: true });

      return {
        input: renderedText.data,
        left: Math.round(overlay.x - renderedText.info.width / 2),
        top: Math.round(overlay.y - renderedText.info.height / 2),
      };
    },
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "An SVG text overlay could not be rendered.",
        operation: "render-text-overlay",
      }),
  });

const compositeTextOverlays = (
  base: Buffer,
  textOverlays: readonly sharp.OverlayOptions[]
) =>
  Effect.tryPromise({
    try: () =>
      sharp(base)
        .composite([...textOverlays])
        .png()
        .toBuffer(),
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "SVG text overlays could not be composed.",
        operation: "render-text-overlay",
      }),
  });

const escapePangoText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
