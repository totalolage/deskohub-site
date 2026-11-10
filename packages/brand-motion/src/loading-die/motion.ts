import {
  axisRotation,
  composeRotations,
  logoCentre,
  type Point,
  type Rotation,
  vertexAxes,
} from "./geometry";
import { type LoadingDieMotion, loadingDieTiming } from "./timing";

/** The point the hop lifts and the squash scales about: the die's base, in logo units. */
export const dieBase: Point = [logoCentre[0], 272];

/** The die at one moment: its rotation, and the hop and squash applied about `dieBase`. */
export interface DiePose {
  readonly rotation: Rotation;
  /** Vertical offset in logo units; negative is up. */
  readonly lift: number;
  readonly scaleX: number;
  readonly scaleY: number;
}

const cycleMilliseconds =
  (loadingDieTiming.frameCount / loadingDieTiming.framesPerSecond) * 1000;
const halfCycleMilliseconds = cycleMilliseconds / 2;
const rollDegrees = 72;
const tumbleRollMilliseconds = 600;
const hopHeight = 40;
const squashDepth = 0.16;
const squashWidening = 0.6;

/** CSS-style cubic-bezier easing, solved by bisection. */
const cubicBezierEasing =
  (x1: number, y1: number, x2: number, y2: number) => (x: number) => {
    if (x <= 0) {
      return 0;
    }
    if (x >= 1) {
      return 1;
    }
    let low = 0;
    let high = 1;
    let t = x;
    for (let step = 0; step < 30; step++) {
      t = (low + high) / 2;
      const u = 1 - t;
      const bx = 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t;
      if (bx < x) {
        low = t;
      } else {
        high = t;
      }
    }
    const u = 1 - t;
    return 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t;
  };

const rollEasing = cubicBezierEasing(0.4, 0.12, 0.45, 1);

const firstRollAxis = vertexAxes[4];
const secondRollAxis = vertexAxes[10];
if (firstRollAxis === undefined || secondRollAxis === undefined) {
  throw new Error("The die has fewer than eleven vertices.");
}
const afterFirstRoll = axisRotation(firstRollAxis, rollDegrees);

/**
 * The pose `milliseconds` into the cycle (0 to 1600 inclusive). Each half
 * cycle rolls the die 72 degrees about a five-fold axis, which lands it on
 * the logo again: first about vertex 4's axis, then back about vertex 10's.
 * "tumble" rolls in 600 ms under a hop, then squashes for 200 ms on landing;
 * "inPlace" spreads each roll over its whole half cycle and stays put.
 */
export const loadingDiePose = (
  motion: LoadingDieMotion,
  milliseconds: number
): DiePose => {
  const secondHalf = milliseconds >= halfCycleMilliseconds;
  const elapsed = milliseconds - (secondHalf ? halfCycleMilliseconds : 0);
  const rollMilliseconds =
    motion === "tumble" ? tumbleRollMilliseconds : halfCycleMilliseconds;
  const progress = Math.min(elapsed / rollMilliseconds, 1);
  const rotation = secondHalf
    ? composeRotations(
        axisRotation(secondRollAxis, -rollDegrees * rollEasing(progress)),
        afterFirstRoll
      )
    : axisRotation(firstRollAxis, rollDegrees * rollEasing(progress));
  if (motion === "inPlace") {
    return { rotation, lift: 0, scaleX: 1, scaleY: 1 };
  }
  const settle =
    elapsed > tumbleRollMilliseconds
      ? (elapsed - tumbleRollMilliseconds) /
        (halfCycleMilliseconds - tumbleRollMilliseconds)
      : 0;
  const squash =
    settle > 0
      ? Math.sin(Math.PI * settle) * Math.exp(-1.5 * settle) * squashDepth
      : 0;
  return {
    rotation,
    lift: -hopHeight * Math.sin(Math.PI * progress),
    scaleX: 1 + squash * squashWidening,
    scaleY: 1 - squash,
  };
};
