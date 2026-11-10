/**
 * The Deskohub loading die: the logo's twenty-sided die tumbling in place.
 *
 * The motion is generated from the die's geometry into Lottie documents that
 * live next to this module; renderers either play a document with a Lottie
 * player or draw sampled frames themselves.
 */

/** How the die moves: the full tumble with a hop and a squash on landing, or rolling in place next to text. */
export type LoadingDieMotion = "tumble" | "inPlace";

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

export const loadingDieTiming: {
  readonly framesPerSecond: number;
  readonly frameCount: number;
} = { framesPerSecond: 60, frameCount: 96 };

/**
 * The loading die as a Lottie document. The same motion and fill return the
 * same object, so players can cache it by identity.
 */
export function loadingDieAnimation(_options: {
  readonly motion: LoadingDieMotion;
  readonly fill: LoadingDieFill;
}): LottieDocument {
  throw new Error("The loading die animation has not been generated yet.");
}

export function loadingDieBox(_motion: LoadingDieMotion): LoadingDieBox {
  throw new Error("The loading die animation has not been generated yet.");
}

/** The frame at `frame` (fractional frames interpolate; any number wraps into the loop). Frame 0 is the still logo. */
export function loadingDieFrame(
  _motion: LoadingDieMotion,
  _frame: number
): LoadingDieFrame {
  throw new Error("The loading die animation has not been generated yet.");
}

export function loadingDieBrandGradient(
  _motion: LoadingDieMotion
): LoadingDieBrandGradient {
  throw new Error("The loading die animation has not been generated yet.");
}
