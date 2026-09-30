import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";

const workspaceRoot = join(import.meta.dir, "..");

const SKELETON_AFTER_SELECTORS = new Set([
  ".motion-reduce\\:after\\:hidden::after",
  ".motion-reduce\\:after\\:hidden:after",
]);

const REDUCED_MOTION_PARAMS = "(prefers-reduced-motion: reduce)";

const isReducedMotionAtRule = (node: postcss.Node): node is postcss.AtRule =>
  node.type === "atrule" &&
  (node as postcss.AtRule).name === "media" &&
  (node as postcss.AtRule).params === REDUCED_MOTION_PARAMS;

const includesReducedMotionAtRule = (rule: postcss.Rule): boolean => {
  let parent = rule.parent;
  while (parent !== undefined) {
    if (isReducedMotionAtRule(parent)) return true;
    parent = parent.parent;
  }
  return false;
};

const declaresDisplayNone = (rule: postcss.Rule): boolean =>
  rule.nodes.some(
    (node): node is postcss.Declaration =>
      node.type === "decl" &&
      (node as postcss.Declaration).prop === "display" &&
      (node as postcss.Declaration).value === "none"
  );

test("the compiled stylesheet hides the skeleton glimmer under reduced motion", async () => {
  const globalsCssPath = join(workspaceRoot, "app", "globals.css");
  const result = await postcss([tailwindcss()]).process(
    readFileSync(globalsCssPath, "utf8"),
    { from: globalsCssPath }
  );

  let reducedMotionSkeletonRule: postcss.Rule | undefined;
  let hasSkeletonGlimmerKeyframes = false;
  result.root.walk((node) => {
    if (node.type === "atrule" && node.name === "keyframes") {
      if (node.params === "skeleton-glimmer")
        hasSkeletonGlimmerKeyframes = true;
    } else if (
      reducedMotionSkeletonRule === undefined &&
      node.type === "rule" &&
      SKELETON_AFTER_SELECTORS.has(node.selector) &&
      declaresDisplayNone(node) &&
      includesReducedMotionAtRule(node)
    ) {
      reducedMotionSkeletonRule = node;
    }
  });

  expect(
    reducedMotionSkeletonRule,
    "expected .motion-reduce\\:after\\:hidden::after { display: none } inside @media (prefers-reduced-motion: reduce)"
  ).toBeDefined();
  expect(hasSkeletonGlimmerKeyframes).toBeTrue();
});
