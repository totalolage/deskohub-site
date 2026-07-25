import { Data } from "effect";

export class OsmTileRequestError extends Data.TaggedError(
  "OsmTileRequestError"
)<{
  readonly cause?: unknown;
  readonly message: string;
  readonly statusCode?: number;
  readonly url: string;
  readonly x: number;
  readonly y: number;
  readonly z: number;
}> {}

export type ImageRenderingOperation =
  | "compose-map-tiles"
  | "encode-static-map"
  | "render-svg"
  | "render-text-overlay";

export class ImageRenderingError extends Data.TaggedError(
  "ImageRenderingError"
)<{
  readonly cause: unknown;
  readonly message: string;
  readonly operation: ImageRenderingOperation;
}> {}
