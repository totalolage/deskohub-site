import { expect, test } from "bun:test";
import {
  findEnabledSnapshotRef,
  getSnapshotRef,
  isFrameSnapshotRef,
} from "./browser";

test("ignores disabled snapshot targets with additional state attributes", () => {
  const snapshot = [
    '- textbox "Card number" [disabled, ref=e1]',
    '- textbox "Card number" [ref=e2]',
  ].join("\n");

  expect(findEnabledSnapshotRef(snapshot, ["Card number"])).toBe("@e2");
});

test("accepts Playwright AI snapshot references from the main page and frames", () => {
  expect(getSnapshotRef('- button "Save" [ref=e2]')).toBe("@e2");
  expect(getSnapshotRef('- textbox "Card number" [ref=f1e4]')).toBe("@f1e4");
  expect(isFrameSnapshotRef("@e2")).toBe(false);
  expect(isFrameSnapshotRef("@f1e4")).toBe(true);
});
