import { expect, test } from "bun:test";
import { announcesLiveRegions } from "./live-region-support";

test("only iOS needs live-region changes announced for it", () => {
  expect(announcesLiveRegions("ios")).toBe(false);
  expect(announcesLiveRegions("android")).toBe(true);
  expect(announcesLiveRegions("web")).toBe(true);
});
