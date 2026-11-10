/**
 * Generates the loading die's Lottie documents from the die geometry and its
 * motion. The output is deterministic; `loading-die-document.test.ts` keeps
 * the committed documents equal to it.
 */

import { type Bounds, paintedBounds, type SampledDieFrame } from "./die-frame";
import { dieFaces, type FaceOutline, logoCentre, type Point } from "./geometry";
import {
  type FaceGroup,
  type GradientFill,
  type LoadingDieLottie,
  type LottieKeyframe,
  type LottieProperty,
  type LottieShape,
  linearEasing,
  type ScalarProperty,
  type VectorProperty,
} from "./lottie";
import { dieBase, loadingDiePose } from "./motion";
import { type LoadingDieMotion, loadingDieTiming } from "./timing";

/** Frames between path keys; players interpolate linearly in between. */
export const keySpacing = 2;
const coordinateDecimals = 1;
const transformDecimals = 2;
/** Room around the painted bounds of every frame, in logo units. */
const boxMargin = 4;
/** Sub-frame steps when measuring the painted bounds. */
const boundsSamplesPerFrame = 4;

/**
 * The colour logo's line gradient (apps/deskohub-workspace/assets/logo/
 * color-bg:dark.svg carries it only as an embedded image): sampled at 5% and
 * 95% along its axis, which leans 6 degrees from vertical. Logo units.
 */
const brandGradient = {
  from: { at: [155.1, 59.4] as Point, color: "#eeb726" },
  to: { at: [133, 266.1] as Point, color: "#da4013" },
} as const;

const round = (value: number, decimals: number) => {
  const factor = 10 ** decimals;
  const rounded = Math.round(value * factor) / factor;
  return rounded === 0 ? 0 : rounded;
};

const frameMilliseconds = (frame: number) =>
  (frame * 1000) / loadingDieTiming.framesPerSecond;

/** The die at `frame` with exact (unrounded) geometry, in logo units. */
const exactFrame = (motion: LoadingDieMotion, frame: number) => {
  const pose = loadingDiePose(motion, frameMilliseconds(frame));
  return { pose, faces: dieFaces(pose.rotation) };
};

const asShape = (face: FaceOutline): LottieShape => ({
  c: true,
  v: face.vertices,
  i: face.inTangents,
  o: face.outTangents,
});

/** Document size and where the logo's origin sits in it. */
export interface LoadingDieLayout {
  readonly width: number;
  readonly height: number;
  readonly offset: Point;
}

export const loadingDieLayout = (
  motion: LoadingDieMotion
): LoadingDieLayout => {
  let bounds: Bounds | undefined;
  const steps = loadingDieTiming.frameCount * boundsSamplesPerFrame;
  for (let step = 0; step <= steps; step++) {
    const { pose, faces } = exactFrame(motion, step / boundsSamplesPerFrame);
    const frame: SampledDieFrame = {
      transform: {
        scaleX: pose.scaleX,
        scaleY: pose.scaleY,
        translateX: dieBase[0] * (1 - pose.scaleX),
        translateY: dieBase[1] * (1 - pose.scaleY) + pose.lift,
      },
      faces: faces.filter((face) => face.visible).map(asShape),
    };
    const painted = paintedBounds(frame);
    if (painted !== undefined) {
      bounds =
        bounds === undefined
          ? painted
          : {
              left: Math.min(bounds.left, painted.left),
              top: Math.min(bounds.top, painted.top),
              right: Math.max(bounds.right, painted.right),
              bottom: Math.max(bounds.bottom, painted.bottom),
            };
    }
  }
  if (bounds === undefined) {
    throw new Error("The die never paints.");
  }
  // Keep the logo centred horizontally so the die rests in the middle of the box.
  const halfWidth =
    Math.max(logoCentre[0] - bounds.left, bounds.right - logoCentre[0]) +
    boxMargin;
  const width = Math.ceil(2 * halfWidth);
  const paintedHeight = bounds.bottom - bounds.top;
  const height = Math.ceil(paintedHeight + 2 * boxMargin);
  return {
    width,
    height,
    offset: [
      round(width / 2 - logoCentre[0], coordinateDecimals),
      round((height - paintedHeight) / 2 - bounds.top, coordinateDecimals),
    ],
  };
};

interface Key<Value> {
  readonly frame: number;
  readonly value: Value;
  readonly hold: boolean;
}

/**
 * Keys for values sampled at `frames`: a run of equivalent values becomes a
 * hold key at its start and a linear key at its end, so players neither
 * redraw nor interpolate across it.
 */
const compressKeys = <Value>(
  frames: readonly number[],
  values: readonly Value[],
  equivalent: (a: Value, b: Value) => boolean
): readonly Key<Value>[] => {
  const keys: Key<Value>[] = [];
  let runStart = 0;
  values.forEach((value, index) => {
    const next = values[index + 1];
    if (next !== undefined && equivalent(value, next)) {
      return;
    }
    const startValue = values[runStart] as Value;
    const startFrame = frames[runStart] as number;
    const frame = frames[index] as number;
    if (runStart < index) {
      keys.push({ frame: startFrame, value: startValue, hold: true });
    }
    keys.push({ frame, value, hold: false });
    runStart = index + 1;
  });
  return keys;
};

const keyedProperty = <Static, Keyed>(
  keys: readonly Key<Static>[],
  wrap: (value: Static) => Keyed
): LottieProperty<Static, Keyed> => {
  const [first] = keys;
  if (first === undefined) {
    throw new Error("A property needs at least one key.");
  }
  // One run over the whole timeline: a hold key and its end key carry the same value.
  if (keys.length === 1 || (keys.length === 2 && first.hold)) {
    return { a: 0, k: first.value };
  }
  return {
    a: 1,
    k: keys.map((key, index): LottieKeyframe<Keyed> => {
      const s = wrap(key.value);
      if (key.hold) {
        return { t: key.frame, s, h: 1 };
      }
      return index === keys.length - 1
        ? { t: key.frame, s }
        : { t: key.frame, s, ...linearEasing };
    }),
  };
};

const sameNumbers = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const roundedPoint = (point: Point, offset: Point): Point => [
  round(point[0] + offset[0], coordinateDecimals),
  round(point[1] + offset[1], coordinateDecimals),
];
const roundedTangent = (point: Point): Point => [
  round(point[0], coordinateDecimals),
  round(point[1], coordinateDecimals),
];

interface KeyedFace {
  readonly visible: boolean;
  readonly shape: LottieShape;
}

const keyedFace = (face: FaceOutline, offset: Point): KeyedFace => ({
  visible: face.visible,
  shape: {
    c: true,
    v: face.vertices.map((point) => roundedPoint(point, offset)),
    i: face.inTangents.map(roundedTangent),
    o: face.outTangents.map(roundedTangent),
  },
});

const sameFace = (a: KeyedFace, b: KeyedFace) =>
  (!a.visible && !b.visible) ||
  (a.visible === b.visible &&
    JSON.stringify(a.shape) === JSON.stringify(b.shape));

const staticScalar = (value: number): ScalarProperty => ({ a: 0, k: value });
const staticVector = (value: readonly number[]): VectorProperty => ({
  a: 0,
  k: value,
});

const colorComponents = (hex: string) =>
  [1, 3, 5].map((start) =>
    round(Number.parseInt(hex.slice(start, start + 2), 16) / 255, 4)
  );

const gradientFill = (offset: Point): GradientFill => ({
  ty: "gf",
  nm: "tint",
  o: staticScalar(100),
  r: 1,
  bm: 0,
  t: 1,
  s: staticVector(roundedPoint(brandGradient.from.at, offset)),
  e: staticVector(roundedPoint(brandGradient.to.at, offset)),
  g: {
    p: 2,
    k: staticVector([
      0,
      ...colorComponents(brandGradient.from.color),
      1,
      ...colorComponents(brandGradient.to.color),
    ]),
  },
});

const groupTransform = {
  ty: "tr",
  p: staticVector([0, 0]),
  a: staticVector([0, 0]),
  s: staticVector([100, 100]),
  r: staticScalar(0),
  o: staticScalar(100),
} as const;

const layerTiming = (index: number, name: string) =>
  ({
    ddd: 0,
    ind: index,
    nm: name,
    sr: 1,
    ao: 0,
    ip: 0,
    op: loadingDieTiming.frameCount,
    st: 0,
    bm: 0,
  }) as const;

const loadingDieDocumentName = (motion: LoadingDieMotion) =>
  motion === "tumble" ? "loading-die-tumble" : "loading-die-in-place";

export const buildLoadingDieDocument = (
  motion: LoadingDieMotion
): LoadingDieLottie => {
  const layout = loadingDieLayout(motion);
  const { offset } = layout;
  const frames = Array.from(
    { length: loadingDieTiming.frameCount / keySpacing + 1 },
    (_, index) => index * keySpacing
  );
  const sampled = frames.map((frame) => exactFrame(motion, frame));
  const faceCount = sampled[0]?.faces.length ?? 0;

  const faces = Array.from({ length: faceCount }, (_, faceIndex): FaceGroup => {
    const values = sampled.map(({ faces: all }) => {
      const face = all[faceIndex];
      if (face === undefined) {
        throw new Error(`Frame without face ${faceIndex}.`);
      }
      return keyedFace(face, offset);
    });
    const keys = compressKeys(frames, values, sameFace).map((key) => ({
      ...key,
      value: key.value.shape,
    }));
    return {
      ty: "gr",
      nm: `face-${String(faceIndex).padStart(2, "0")}`,
      it: [
        {
          ty: "sh",
          nm: "outline",
          ks: keyedProperty(keys, (shape): readonly [LottieShape] => [shape]),
        },
        groupTransform,
      ],
    };
  });

  const anchor: Point = [
    round(dieBase[0] + offset[0], coordinateDecimals),
    round(dieBase[1] + offset[1], coordinateDecimals),
  ];
  const lifts = sampled.map(({ pose }) =>
    round(anchor[1] + pose.lift, transformDecimals)
  );
  const scales = sampled.map(({ pose }) => [
    round(pose.scaleX * 100, transformDecimals),
    round(pose.scaleY * 100, transformDecimals),
    100,
  ]);

  return {
    v: "5.12.2",
    nm: loadingDieDocumentName(motion),
    fr: loadingDieTiming.framesPerSecond,
    ip: 0,
    op: loadingDieTiming.frameCount,
    w: layout.width,
    h: layout.height,
    ddd: 0,
    assets: [],
    layers: [
      {
        ...layerTiming(1, "hop"),
        ty: 3,
        ks: {
          o: staticScalar(100),
          r: staticScalar(0),
          p: {
            s: true,
            x: staticScalar(anchor[0]),
            y: keyedProperty(
              compressKeys(frames, lifts, (a, b) => a === b),
              (value): readonly [number] => [value]
            ),
          },
          a: staticVector([anchor[0], anchor[1], 0]),
          s: keyedProperty(
            compressKeys(frames, scales, sameNumbers),
            (value) => value
          ),
        },
      },
      {
        ...layerTiming(2, "die"),
        ty: 4,
        parent: 1,
        ks: {
          o: staticScalar(100),
          r: staticScalar(0),
          p: staticVector([0, 0, 0]),
          a: staticVector([0, 0, 0]),
          s: staticVector([100, 100, 100]),
        },
        shapes: [...faces, gradientFill(offset)],
      },
    ],
  };
};

export const serializeLoadingDieDocument = (document: LoadingDieLottie) =>
  `${JSON.stringify(document)}\n`;
