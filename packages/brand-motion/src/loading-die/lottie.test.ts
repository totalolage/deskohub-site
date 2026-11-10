import { describe, expect, test } from "bun:test";
import type { Point } from "./geometry";
import {
  type LottieShape,
  linearEasing,
  type ScalarProperty,
  type ShapeProperty,
  sampleScalar,
  sampleShape,
  sampleVector,
} from "./lottie";

/** 10 at frame 2, linear to 20 at frame 6, held at 30 from frame 8 until 40 at frame 10. */
const scalar: ScalarProperty = {
  a: 1,
  k: [
    { t: 2, s: [10], ...linearEasing },
    { t: 6, s: [20], ...linearEasing },
    { t: 8, s: [30], h: 1 },
    { t: 10, s: [40] },
  ],
};

describe("sampleScalar", () => {
  test.each([
    [0, 10],
    [2, 10],
    [3, 12.5],
    [5.5, 18.75],
    [7, 25],
    [8, 30],
    [9.999, 30],
    [10, 40],
    [12, 40],
  ])("at frame %p is %p", (frame, value) => {
    expect(sampleScalar(scalar, frame)).toBeCloseTo(value, 9);
  });

  test("returns a static value at every frame", () => {
    expect(sampleScalar({ a: 0, k: 7 }, 123.4)).toBe(7);
  });
});

test("sampleVector interpolates each component", () => {
  expect(
    sampleVector(
      {
        a: 1,
        k: [
          { t: 0, s: [100, 100, 100], ...linearEasing },
          { t: 4, s: [120, 80, 100] },
        ],
      },
      1
    )
  ).toEqual([105, 95, 100]);
});

const triangle = (points: readonly Point[], tangent: Point): LottieShape => ({
  c: true,
  v: points,
  i: points.map(() => tangent),
  o: points.map((): Point => [-tangent[0], -tangent[1]]),
});

describe("sampleShape", () => {
  const collapsed = triangle(
    [
      [5, 5],
      [5, 5],
      [5, 5],
    ],
    [0, 0]
  );
  const open = triangle(
    [
      [0, 0],
      [10, 0],
      [5, 10],
    ],
    [2, 4]
  );
  const shape: ShapeProperty = {
    a: 1,
    k: [
      { t: 0, s: [collapsed], h: 1 },
      { t: 4, s: [collapsed], ...linearEasing },
      { t: 6, s: [open] },
    ],
  };

  test("holds a collapsed face until its last hidden key", () => {
    expect(sampleShape(shape, 3.9)).toEqual(collapsed);
  });

  test("grows vertices and tangents linearly toward the next key", () => {
    expect(sampleShape(shape, 5)).toEqual({
      c: true,
      v: [
        [2.5, 2.5],
        [7.5, 2.5],
        [5, 7.5],
      ],
      i: [
        [1, 2],
        [1, 2],
        [1, 2],
      ],
      o: [
        [-1, -2],
        [-1, -2],
        [-1, -2],
      ],
    });
  });

  test("keeps the last key's shape past the end", () => {
    expect(sampleShape(shape, 96)).toEqual(open);
  });
});
