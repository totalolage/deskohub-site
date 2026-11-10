/**
 * The Deskohub loading die: the logo's twenty-sided die tumbling in place.
 *
 * The motion is generated from the die's geometry into Lottie documents that
 * live next to this module; renderers either play a document with a Lottie
 * player or draw sampled frames themselves.
 */

import {
  faceIsDrawn,
  facePathData,
  paintedBounds,
  sampleDieFrame,
  transformAttribute,
} from "./die-frame";
import inPlaceDocument from "./loading-die-in-place.lottie.json";
import tumbleDocument from "./loading-die-tumble.lottie.json";
import {
  isLoadingDieLottie,
  type LoadingDieLottie,
  type SolidFill,
} from "./lottie";
import type { LoadingDieMotion } from "./timing";

export { type LoadingDieMotion, loadingDieTiming } from "./timing";

/** Fill of the die's faces: the brand gradient from the colour logo, or one solid `#rrggbb` colour. */
export type LoadingDieFill =
  | { readonly kind: "brand" }
  | { readonly kind: "solid"; readonly color: `#${string}` };

/** A Lottie (Bodymovin) document. */
export type LottieDocument = Readonly<Record<string, unknown>> & {
  readonly w: number;
  readonly h: number;
  readonly fr: number;
  readonly ip: number;
  readonly op: number;
};

/** Size of a motion's document and of the die at rest inside it, in document units. */
export interface LoadingDieBox {
  readonly width: number;
  readonly height: number;
  readonly dieHeight: number;
}

/** One frame drawn as SVG, in document units, for renderers without a Lottie player. */
export interface LoadingDieFrame {
  /** SVG `transform` attribute for the group holding the faces (the hop and squash). */
  readonly transform: string;
  /** SVG path data of each visible face. */
  readonly faces: readonly string[];
}

/** Two ends of the brand gradient in document units, for an SVG `linearGradient` in user space. */
export interface LoadingDieBrandGradient {
  readonly from: {
    readonly x: number;
    readonly y: number;
    readonly color: `#${string}`;
  };
  readonly to: {
    readonly x: number;
    readonly y: number;
    readonly color: `#${string}`;
  };
}

const committedDocument = (json: unknown): LoadingDieLottie => {
  if (!isLoadingDieLottie(json)) {
    throw new Error("A committed loading die document is malformed.");
  }
  return json;
};

const documents: Readonly<Record<LoadingDieMotion, LoadingDieLottie>> = {
  tumble: committedDocument(tumbleDocument),
  inPlace: committedDocument(inPlaceDocument),
};

const solidColorPattern = /^#[0-9a-f]{6}$/i;

const solidFill = (color: string): SolidFill => ({
  ty: "fl",
  nm: "tint",
  o: { a: 0, k: 100 },
  c: {
    a: 0,
    k: [
      ...[1, 3, 5].map(
        (start) => Number.parseInt(color.slice(start, start + 2), 16) / 255
      ),
      1,
    ],
  },
  r: 1,
  bm: 0,
});

/** The document with its "tint" fill (the last item of the die layer) replaced; everything else is shared. */
const withFill = (
  document: LoadingDieLottie,
  fill: SolidFill
): LoadingDieLottie => {
  const [hop, die] = document.layers;
  return {
    ...document,
    layers: [hop, { ...die, shapes: [...die.shapes.slice(0, -1), fill] }],
  };
};

const animations = new Map<string, LoadingDieLottie>();

/**
 * The loading die as a Lottie document. The same motion and fill return the
 * same object, so players can cache it by identity. A solid fill differs from
 * the brand document only in its fill item.
 */
export function loadingDieAnimation(options: {
  readonly motion: LoadingDieMotion;
  readonly fill: LoadingDieFill;
}): LottieDocument {
  const { motion, fill } = options;
  if (fill.kind === "brand") {
    return documents[motion];
  }
  if (!solidColorPattern.test(fill.color)) {
    throw new RangeError(
      `The loading die fill colour must be #rrggbb, got ${fill.color}.`
    );
  }
  const color = fill.color.toLowerCase();
  const key = `${motion}:${color}`;
  const cached = animations.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const animation = withFill(documents[motion], solidFill(color));
  animations.set(key, animation);
  return animation;
}

const boxes = new Map<LoadingDieMotion, LoadingDieBox>();

/**
 * The document's size, which holds every frame without clipping, and the
 * height of the die at rest (frame 0) inside it.
 */
export function loadingDieBox(motion: LoadingDieMotion): LoadingDieBox {
  const cached = boxes.get(motion);
  if (cached !== undefined) {
    return cached;
  }
  const document = documents[motion];
  const rest = paintedBounds(sampleDieFrame(document, 0));
  if (rest === undefined) {
    throw new Error("The loading die draws nothing at rest.");
  }
  const box = {
    width: document.w,
    height: document.h,
    dieHeight: rest.bottom - rest.top,
  };
  boxes.set(motion, box);
  return box;
}

/** The frame at `frame` (fractional frames interpolate; any number wraps into the loop). Frame 0 is the still logo. */
export function loadingDieFrame(
  motion: LoadingDieMotion,
  frame: number
): LoadingDieFrame {
  if (!Number.isFinite(frame)) {
    throw new RangeError(`The loading die frame must be finite, got ${frame}.`);
  }
  const document = documents[motion];
  const length = document.op - document.ip;
  const sampled = sampleDieFrame(
    document,
    document.ip + ((((frame - document.ip) % length) + length) % length)
  );
  return {
    transform: transformAttribute(sampled.transform),
    faces: sampled.faces.filter(faceIsDrawn).map(facePathData),
  };
}

const hexColor = (components: readonly number[]): `#${string}` =>
  `#${components
    .map((component) =>
      Math.round(component * 255)
        .toString(16)
        .padStart(2, "0")
    )
    .join("")}`;

/**
 * The brand gradient of the committed document. Its coordinates are the die
 * group's own, so put the gradient inside the group that carries
 * `LoadingDieFrame.transform` and it hops and squashes with the faces.
 */
export function loadingDieBrandGradient(
  motion: LoadingDieMotion
): LoadingDieBrandGradient {
  const tint = documents[motion].layers[1].shapes.at(-1);
  if (
    tint?.ty !== "gf" ||
    tint.s.a !== 0 ||
    tint.e.a !== 0 ||
    tint.g.k.a !== 0
  ) {
    throw new Error("The loading die document has no static brand gradient.");
  }
  const [fromX = 0, fromY = 0] = tint.s.k;
  const [toX = 0, toY = 0] = tint.e.k;
  const stops = tint.g.k.k;
  return {
    from: { x: fromX, y: fromY, color: hexColor(stops.slice(1, 4)) },
    to: { x: toX, y: toY, color: hexColor(stops.slice(5, 8)) },
  };
}
