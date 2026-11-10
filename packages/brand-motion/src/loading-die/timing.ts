/** How the die moves: the full tumble with a hop and a squash on landing, or rolling in place next to text. */
export type LoadingDieMotion = "tumble" | "inPlace";

export const loadingDieTiming: {
  readonly framesPerSecond: number;
  readonly frameCount: number;
} = { framesPerSecond: 60, frameCount: 96 };
