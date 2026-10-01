import { Effect, Option } from "effect";
import sharp, { type OverlayOptions } from "sharp";
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
  readonly canvas?: {
    readonly width: number;
    readonly height: number;
    readonly padding?: number;
    readonly background?: string;
  };
}

export const generateSvgPngBuffer = Effect.fn("osm.generateSvgPngBuffer")(
  (svg: string | Buffer, options: SvgPngBufferOptions = {}) =>
    renderSvg(svg).pipe(
      Effect.bindTo("base"),
      Effect.bind("textOverlays", () =>
        Effect.all((options.textOverlays ?? []).map(renderTextOverlay), {
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
      ),
      Effect.flatMap((image) =>
        options.canvas
          ? renderSvgPngCanvas(image, options.canvas)
          : Effect.succeed(image)
      )
    )
);

type SvgPngCanvas = NonNullable<SvgPngBufferOptions["canvas"]>;

const renderSvgPngCanvas = (image: Buffer, canvas: SvgPngCanvas) =>
  Effect.tryPromise({
    try: () => {
      const padding = canvas.padding ?? 0;
      const contentWidth = canvas.width - 2 * padding;
      const contentHeight = canvas.height - 2 * padding;

      if (
        !Number.isSafeInteger(canvas.width) ||
        !Number.isSafeInteger(canvas.height) ||
        !Number.isSafeInteger(padding) ||
        canvas.width <= 0 ||
        canvas.height <= 0 ||
        padding < 0 ||
        contentWidth <= 0 ||
        contentHeight <= 0
      ) {
        throw new RangeError(
          "Canvas dimensions and padding must leave positive pixel dimensions."
        );
      }

      const background = canvas.background ?? {
        r: 0,
        g: 0,
        b: 0,
        alpha: 0,
      };
      const source = sharp(image);
      const flattened = canvas.background
        ? source.flatten({ background: canvas.background })
        : source;

      return flattened
        .resize(contentWidth, contentHeight, {
          fit: "contain",
          background,
        })
        .extend({
          top: padding,
          right: padding,
          bottom: padding,
          left: padding,
          background,
        })
        .png()
        .toBuffer();
    },
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "The SVG image could not be rendered on the requested canvas.",
        operation: "render-svg",
      }),
  });

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
    try: async (): Promise<OverlayOptions> => {
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
  textOverlays: readonly OverlayOptions[]
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
