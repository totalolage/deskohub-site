import { describe, expect, test } from "bun:test";
import {
  faceGroups,
  faceIsDrawn,
  paintedBounds,
  type SampledDieFrame,
  sampleDieFrame,
} from "./die-frame";
import type { Point } from "./geometry";
import {
  type LoadingDieMotion,
  loadingDieAnimation,
  loadingDieBox,
  loadingDieBrandGradient,
  loadingDieFrame,
  loadingDieTiming,
} from "./index";
import type { LoadingDieLottie, LottieShape } from "./lottie";

const motions = ["tumble", "inPlace"] as const;
const brandDocument = (motion: LoadingDieMotion) =>
  loadingDieAnimation({ motion, fill: { kind: "brand" } }) as LoadingDieLottie;
const lastFrame = loadingDieTiming.frameCount;

/** Rounding to one decimal can move a vertex by 0.05 per axis. */
const roundingTolerance = 0.15;
const identityTransform = "matrix(1 0 0 1 0 0)";

const drawnFaces = (frame: SampledDieFrame) => frame.faces.filter(faceIsDrawn);

const distance = (a: Point | undefined, b: Point | undefined) =>
  a === undefined || b === undefined
    ? Number.POSITIVE_INFINITY
    : Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Two faces draw the same outline when their vertices agree up to where the path starts. */
const sameOutline = (a: LottieShape, b: LottieShape) =>
  a.v.some((_, shift) =>
    a.v.every(
      (vertex, index) =>
        distance(vertex, b.v[(index + shift) % b.v.length]) <=
          roundingTolerance &&
        distance(a.i[index], b.i[(index + shift) % b.v.length]) <=
          roundingTolerance &&
        distance(a.o[index], b.o[(index + shift) % b.v.length]) <=
          roundingTolerance
    )
  );

/** Whether two frames draw the same set of outlines, whichever face draws each. */
const sameFaceSet = (a: readonly LottieShape[], b: readonly LottieShape[]) => {
  if (a.length !== b.length) {
    return false;
  }
  const unmatched = [...b];
  return a.every((face) => {
    const match = unmatched.findIndex((candidate) =>
      sameOutline(face, candidate)
    );
    if (match === -1) {
      return false;
    }
    unmatched.splice(match, 1);
    return true;
  });
};

/** Where a die-layer point is drawn in the document. */
const drawn = (frame: SampledDieFrame, point: Point): Point => [
  frame.transform.scaleX * point[0] + frame.transform.translateX,
  frame.transform.scaleY * point[1] + frame.transform.translateY,
];

/** The largest distance any drawn vertex moves between two frames, hop and squash included. */
const largestStep = (a: SampledDieFrame, b: SampledDieFrame) =>
  Math.max(
    ...a.faces.flatMap((face, index) => {
      const other = b.faces[index];
      if (other === undefined || (!faceIsDrawn(face) && !faceIsDrawn(other))) {
        return [];
      }
      return face.v.map((vertex, corner) => {
        const target = other.v[corner];
        return target === undefined
          ? Number.POSITIVE_INFINITY
          : distance(drawn(a, vertex), drawn(b, target));
      });
    })
  );

describe.each([...motions])("the %s loop", (motion) => {
  const document = brandDocument(motion);
  const start = sampleDieFrame(document, 0);
  const end = sampleDieFrame(document, document.op);

  test("ends on the faces and transform it starts with", () => {
    expect(drawnFaces(start).length).toBeGreaterThan(0);
    expect(sameFaceSet(drawnFaces(end), drawnFaces(start))).toBe(true);
    expect(end.transform).toEqual(start.transform);
  });

  test("steps from its last frame into the loop no further than between any two frames", () => {
    const interiorSteps = Array.from({ length: document.op - 1 }, (_, frame) =>
      largestStep(
        sampleDieFrame(document, frame),
        sampleDieFrame(document, frame + 1)
      )
    );
    expect(
      largestStep(sampleDieFrame(document, document.op - 1), end)
    ).toBeLessThanOrEqual(Math.max(...interiorSteps));
  });

  test("wraps frames into the loop", () => {
    expect(loadingDieFrame(motion, lastFrame)).toEqual(
      loadingDieFrame(motion, 0)
    );
    expect(loadingDieFrame(motion, -1)).toEqual(
      loadingDieFrame(motion, lastFrame - 1)
    );
    expect(loadingDieFrame(motion, 2 * lastFrame + 10.5)).toEqual(
      loadingDieFrame(motion, 10.5)
    );
  });

  test("starts on the still logo", () => {
    const rest = loadingDieFrame(motion, 0);
    expect(rest.transform).toBe(identityTransform);
    expect(rest.faces).toHaveLength(drawnFaces(start).length);
  });

  test("never paints outside its box", () => {
    const box = loadingDieBox(motion);
    expect([box.width, box.height]).toEqual([document.w, document.h]);
    for (let step = 0; step <= document.op * 4; step++) {
      const bounds = paintedBounds(sampleDieFrame(document, step / 4));
      if (bounds === undefined) {
        throw new Error(`Nothing drawn at frame ${step / 4}.`);
      }
      expect(bounds.left).toBeGreaterThanOrEqual(0);
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.right).toBeLessThanOrEqual(box.width);
      expect(bounds.bottom).toBeLessThanOrEqual(box.height);
    }
  });

  test("measures the die at rest", () => {
    const rest = paintedBounds(start);
    const box = loadingDieBox(motion);
    expect(box.dieHeight).toBe((rest?.bottom ?? 0) - (rest?.top ?? 0));
    expect(box.dieHeight).toBeLessThanOrEqual(box.height);
  });
});

describe("landings", () => {
  const landings: Record<LoadingDieMotion, readonly number[]> = {
    tumble: [36, 48, 84],
    inPlace: [48],
  };

  test.each([...motions])("the %s motion lands on the logo", (motion) => {
    const document = brandDocument(motion);
    const rest = drawnFaces(sampleDieFrame(document, 0));
    for (const frame of landings[motion]) {
      expect(
        sameFaceSet(drawnFaces(sampleDieFrame(document, frame)), rest)
      ).toBe(true);
      expect(loadingDieFrame(motion, frame).transform).toBe(identityTransform);
    }
  });

  test("both motions rest on the same die", () => {
    const tumble = loadingDieBox("tumble");
    const inPlace = loadingDieBox("inPlace");
    expect(Math.abs(tumble.dieHeight - inPlace.dieHeight)).toBeLessThan(0.01);
  });
});

describe("loadingDieAnimation", () => {
  test("returns the same document for the same motion and fill", () => {
    expect(brandDocument("tumble")).toBe(brandDocument("tumble"));
    const white = loadingDieAnimation({
      motion: "inPlace",
      fill: { kind: "solid", color: "#FFFFFF" },
    });
    expect(
      loadingDieAnimation({
        motion: "inPlace",
        fill: { kind: "solid", color: "#ffffff" },
      })
    ).toBe(white);
    expect(
      loadingDieAnimation({
        motion: "tumble",
        fill: { kind: "solid", color: "#ffffff" },
      })
    ).not.toBe(white);
  });

  test("derives a solid fill by replacing only the tint fill", () => {
    const brand = brandDocument("tumble");
    const navy = loadingDieAnimation({
      motion: "tumble",
      fill: { kind: "solid", color: "#00024f" },
    }) as LoadingDieLottie;
    expect(navy.layers[0]).toBe(brand.layers[0]);
    const brandShapes = brand.layers[1].shapes;
    const navyShapes = navy.layers[1].shapes;
    expect(navyShapes).toHaveLength(brandShapes.length);
    expect(faceGroups(navy)).toEqual(faceGroups(brand));
    faceGroups(navy).forEach((group, index) => {
      expect(group).toBe(brandShapes[index] as typeof group);
    });
    expect(navyShapes.at(-1)).toEqual({
      ty: "fl",
      nm: "tint",
      o: { a: 0, k: 100 },
      c: { a: 0, k: [0, 2 / 255, 79 / 255, 1] },
      r: 1,
      bm: 0,
    });
    expect({ ...navy, layers: [] }).toEqual({ ...brand, layers: [] });
  });

  test("rejects a colour that is not #rrggbb", () => {
    expect(() =>
      loadingDieAnimation({
        motion: "tumble",
        fill: { kind: "solid", color: "#fff" },
      })
    ).toThrow(RangeError);
  });
});

describe("loadingDieBrandGradient", () => {
  test.each([...motions])("reads the %s document's tint gradient", (motion) => {
    const gradient = loadingDieBrandGradient(motion);
    const tint = brandDocument(motion).layers[1].shapes.at(-1);
    if (tint?.ty !== "gf" || tint.s.a !== 0 || tint.e.a !== 0) {
      throw new Error("The brand document has no static gradient.");
    }
    expect([gradient.from.x, gradient.from.y]).toEqual([...tint.s.k]);
    expect([gradient.to.x, gradient.to.y]).toEqual([...tint.e.k]);
    expect(gradient.from.color).toMatch(/^#[0-9a-f]{6}$/);
    expect(gradient.to.color).toMatch(/^#[0-9a-f]{6}$/);
  });
});

describe("loadingDieFrame", () => {
  test("rejects a frame that is not finite", () => {
    expect(() => loadingDieFrame("tumble", Number.NaN)).toThrow(RangeError);
  });

  test("draws closed SVG paths", () => {
    for (const face of loadingDieFrame("tumble", 17.5).faces) {
      expect(face).toMatch(/^M[-\d. ]+(?:[LC][-\d. ]+)+Z$/);
    }
  });
});
