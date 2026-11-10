/**
 * One frame of a loading die document, read the way a Lottie player reads it:
 * the faces' paths and the parent layer's hop and squash.
 */

import type { Point } from "./geometry";
import {
  type FaceGroup,
  type LoadingDieLottie,
  type LottieShape,
  sampleScalar,
  sampleShape,
  sampleVector,
} from "./lottie";

/** Maps die-layer coordinates to document coordinates: x' = scaleX * x + translateX. */
export interface DieTransform {
  readonly scaleX: number;
  readonly scaleY: number;
  readonly translateX: number;
  readonly translateY: number;
}

export interface SampledDieFrame {
  readonly transform: DieTransform;
  /** Every face in document order, including collapsed ones. */
  readonly faces: readonly LottieShape[];
}

export interface Bounds {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

export const faceGroups = (document: LoadingDieLottie): readonly FaceGroup[] =>
  document.layers[1].shapes.filter(
    (item): item is FaceGroup => item.ty === "gr"
  );

/** The frame at `frame` on the document's own timeline (no wrapping; past the last key holds it). */
export const sampleDieFrame = (
  document: LoadingDieLottie,
  frame: number
): SampledDieFrame => {
  const hop = document.layers[0].ks;
  const [anchorX = 0, anchorY = 0] = hop.a.a === 0 ? hop.a.k : [];
  const [scaleX = 100, scaleY = 100] = sampleVector(hop.s, frame);
  const x = sampleScalar(hop.p.x, frame);
  const y = sampleScalar(hop.p.y, frame);
  return {
    transform: {
      scaleX: scaleX / 100,
      scaleY: scaleY / 100,
      translateX: x - (scaleX / 100) * anchorX,
      translateY: y - (scaleY / 100) * anchorY,
    },
    faces: faceGroups(document).map((group) =>
      sampleShape(group.it[0].ks, frame)
    ),
  };
};

/** A face collapsed to a point draws nothing. */
export const faceIsDrawn = (face: LottieShape) => {
  const [first] = face.v;
  return (
    first !== undefined &&
    face.v.some((point) => point[0] !== first[0] || point[1] !== first[1])
  );
};

const segments = (face: LottieShape) =>
  face.v.map((start, index) => {
    const endIndex = (index + 1) % face.v.length;
    const end = face.v[endIndex] ?? start;
    const out = face.o[index] ?? [0, 0];
    const into = face.i[endIndex] ?? [0, 0];
    return {
      start,
      control1: [start[0] + out[0], start[1] + out[1]] as Point,
      control2: [end[0] + into[0], end[1] + into[1]] as Point,
      end,
      straight: out[0] === 0 && out[1] === 0 && into[0] === 0 && into[1] === 0,
    };
  });

const formatNumber = (value: number, decimals = 2) => {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return String(rounded === 0 ? 0 : rounded);
};
const formatPoint = (point: Point) =>
  `${formatNumber(point[0])} ${formatNumber(point[1])}`;

/** SVG path data for a face, in die-layer coordinates. */
export const facePathData = (face: LottieShape) => {
  const [first] = face.v;
  if (first === undefined) {
    return "";
  }
  const commands = segments(face).map((segment) =>
    segment.straight
      ? `L${formatPoint(segment.end)}`
      : `C${formatPoint(segment.control1)} ${formatPoint(segment.control2)} ${formatPoint(segment.end)}`
  );
  return `M${formatPoint(first)}${commands.join("")}Z`;
};

/** SVG `transform` attribute for a die transform. */
export const transformAttribute = (transform: DieTransform) =>
  `matrix(${[
    transform.scaleX,
    0,
    0,
    transform.scaleY,
    transform.translateX,
    transform.translateY,
  ]
    .map((value) => formatNumber(value, 4))
    .join(" ")})`;

/** Parameters where a quadratic a t^2 + b t + c is zero. */
const quadraticRoots = (a: number, b: number, c: number): number[] => {
  if (Math.abs(a) < 1e-12) {
    return Math.abs(b) < 1e-12 ? [] : [-c / b];
  }
  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0) {
    return [];
  }
  const root = Math.sqrt(discriminant);
  return [(-b + root) / (2 * a), (-b - root) / (2 * a)];
};

/** Extremes of one coordinate of a cubic bezier segment. */
const cubicRange = (p0: number, p1: number, p2: number, p3: number) => {
  // Where the derivative of the cubic vanishes.
  const roots = quadraticRoots(
    3 * (-p0 + 3 * p1 - 3 * p2 + p3),
    6 * (p0 - 2 * p1 + p2),
    3 * (p1 - p0)
  );
  const values = [p0, p3];
  for (const t of roots) {
    if (t > 0 && t < 1) {
      const u = 1 - t;
      values.push(
        u * u * u * p0 +
          3 * u * u * t * p1 +
          3 * u * t * t * p2 +
          t * t * t * p3
      );
    }
  }
  return { min: Math.min(...values), max: Math.max(...values) };
};

const mergeBounds = (a: Bounds | undefined, b: Bounds): Bounds =>
  a === undefined
    ? b
    : {
        left: Math.min(a.left, b.left),
        top: Math.min(a.top, b.top),
        right: Math.max(a.right, b.right),
        bottom: Math.max(a.bottom, b.bottom),
      };

/** Painted bounds of the drawn faces in document coordinates (the transform's scale is positive). */
export const paintedBounds = (frame: SampledDieFrame): Bounds | undefined => {
  let bounds: Bounds | undefined;
  for (const face of frame.faces.filter(faceIsDrawn)) {
    for (const segment of segments(face)) {
      const x = cubicRange(
        segment.start[0],
        segment.control1[0],
        segment.control2[0],
        segment.end[0]
      );
      const y = cubicRange(
        segment.start[1],
        segment.control1[1],
        segment.control2[1],
        segment.end[1]
      );
      const { scaleX, scaleY, translateX, translateY } = frame.transform;
      bounds = mergeBounds(bounds, {
        left: scaleX * x.min + translateX,
        top: scaleY * y.min + translateY,
        right: scaleX * x.max + translateX,
        bottom: scaleY * y.max + translateY,
      });
    }
  }
  return bounds;
};
