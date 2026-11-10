import { describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { faceGroups, faceIsDrawn, sampleDieFrame } from "./die-frame";
import { dieFaces, type Point } from "./geometry";
import {
  buildLoadingDieDocument,
  keySpacing,
  loadingDieLayout,
  serializeLoadingDieDocument,
} from "./loading-die-document";
import type { LoadingDieLottie } from "./lottie";
import { dieBase, loadingDiePose } from "./motion";
import { type LoadingDieMotion, loadingDieTiming } from "./timing";

/**
 * The committed documents are generated. Regenerate them with
 * `UPDATE_LOADING_DIE=1 bun test src/loading-die/loading-die-document.test.ts`
 * and look at the frames before committing.
 */
const committed: Record<LoadingDieMotion, URL> = {
  tumble: new URL("./loading-die-tumble.lottie.json", import.meta.url),
  inPlace: new URL("./loading-die-in-place.lottie.json", import.meta.url),
};
const motions = ["tumble", "inPlace"] as const;
const byteBudget = 150_000;

const generated = Object.fromEntries(
  motions.map((motion) => [
    motion,
    serializeLoadingDieDocument(buildLoadingDieDocument(motion)),
  ])
) as Record<LoadingDieMotion, string>;

if (process.env.UPDATE_LOADING_DIE === "1") {
  for (const motion of motions) {
    writeFileSync(committed[motion], generated[motion]);
  }
}

const committedText = (motion: LoadingDieMotion) =>
  readFileSync(committed[motion], "utf8");
const committedDocument = (motion: LoadingDieMotion) =>
  JSON.parse(committedText(motion)) as LoadingDieLottie;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

describe.each([...motions])("the %s document", (motion) => {
  test("is the generator's output, byte for byte", () => {
    expect(committedText(motion)).toBe(generated[motion]);
  });

  test("fits the byte budget", () => {
    expect(Buffer.byteLength(committedText(motion))).toBeLessThanOrEqual(
      byteBudget
    );
  });

  test("has a hop null parenting one die layer of twenty faces and a tint fill", () => {
    const document = committedDocument(motion);
    expect(document.fr).toBe(loadingDieTiming.framesPerSecond);
    expect(document.op - document.ip).toBe(loadingDieTiming.frameCount);
    const [hop, die] = document.layers;
    expect(hop.ty).toBe(3);
    expect(die.ty).toBe(4);
    expect(die.parent).toBe(hop.ind);
    const groups = faceGroups(document);
    expect(groups.map((group) => group.nm)).toEqual(
      Array.from(
        { length: 20 },
        (_, index) => `face-${String(index).padStart(2, "0")}`
      )
    );
    for (const group of groups) {
      const outline = group.it[0].ks;
      const shapes =
        outline.a === 0 ? [outline.k] : outline.k.map((key) => key.s[0]);
      for (const shape of shapes) {
        expect(shape.c).toBe(true);
        expect([shape.v.length, shape.i.length, shape.o.length]).toEqual([
          6, 6, 6,
        ]);
      }
    }
    const tint = die.shapes.at(-1);
    expect(tint?.nm).toBe("tint");
    expect(tint?.ty).toBe("gf");
    expect(die.shapes.filter((item) => item.ty !== "gr")).toHaveLength(1);
  });

  test("matches the die geometry within half a unit at every keyed frame", () => {
    const document = committedDocument(motion);
    const { offset } = loadingDieLayout(motion);
    for (let frame = 0; frame <= document.op; frame += keySpacing) {
      const pose = loadingDiePose(
        motion,
        (frame * 1000) / loadingDieTiming.framesPerSecond
      );
      const sampled = sampleDieFrame(document, frame);
      const { transform } = sampled;
      // The parent maps the die base to itself, lifted by the hop.
      const base: Point = [dieBase[0] + offset[0], dieBase[1] + offset[1]];
      expect(
        distance(
          [
            transform.scaleX * base[0] + transform.translateX,
            transform.scaleY * base[1] + transform.translateY,
          ],
          [base[0], base[1] + pose.lift]
        )
      ).toBeLessThan(0.5);
      expect(Math.abs(transform.scaleX - pose.scaleX)).toBeLessThan(1e-3);
      expect(Math.abs(transform.scaleY - pose.scaleY)).toBeLessThan(1e-3);

      dieFaces(pose.rotation).forEach((face, index) => {
        const shape = sampled.faces[index];
        if (shape === undefined) {
          throw new Error(`Face ${index} is missing at frame ${frame}.`);
        }
        expect(faceIsDrawn(shape)).toBe(face.visible);
        if (!face.visible) {
          return;
        }
        face.vertices.forEach((vertex, corner) => {
          const at = (point: Point | undefined): Point =>
            point ?? [Number.NaN, Number.NaN];
          const exact: Point = [vertex[0] + offset[0], vertex[1] + offset[1]];
          const drawn = at(shape.v[corner]);
          expect(distance(drawn, exact)).toBeLessThan(0.5);
          for (const [exactTangent, drawnTangent] of [
            [face.inTangents[corner], shape.i[corner]],
            [face.outTangents[corner], shape.o[corner]],
          ] as const) {
            const tangentEnd = at(exactTangent);
            const drawnEnd = at(drawnTangent);
            expect(
              distance(
                [drawn[0] + drawnEnd[0], drawn[1] + drawnEnd[1]],
                [exact[0] + tangentEnd[0], exact[1] + tangentEnd[1]]
              )
            ).toBeLessThan(0.5);
          }
        });
      });
    }
  });
});
