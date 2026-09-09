import { expect, test } from "bun:test";
import {
  accountMetricRegionGeometry,
  accountMetricRegionsByScreen,
  calculateRgbMetrics,
  comparisonPaddingColor,
  makeAbsoluteRgbDifference,
  makeFiftyFiftyOverlay,
  makeTopLeftComparisonCanvas,
  type RgbaImage,
} from "./metrics";

const image = (data: number[]): RgbaImage => ({
  width: 2,
  height: 1,
  data: new Uint8Array(data),
});

test("RGB metrics count only max-channel deltas greater than 16", () => {
  const reference = image([10, 20, 30, 255, 10, 20, 30, 255]);
  const candidate = image([26, 20, 30, 255, 27, 20, 30, 255]);

  expect(calculateRgbMetrics(reference, candidate)).toEqual({
    meanAbsoluteRgbError: 5.5,
    mismatchPercentage: 50,
    maxChannelDelta: 17,
    pixelCount: 2,
  });
});

test("top-left comparison preserves native pixels and pads with white", () => {
  const source: RgbaImage = {
    width: 1,
    height: 1,
    data: new Uint8Array([100, 150, 200, 128]),
  };
  const result = makeTopLeftComparisonCanvas(source, { width: 2, height: 1 });

  expect(result.placement).toEqual({
    sourceWidth: 1,
    sourceHeight: 1,
    targetWidth: 2,
    targetHeight: 1,
    copiedWidth: 1,
    copiedHeight: 1,
    croppedRight: 0,
    croppedBottom: 0,
    paddedRight: 1,
    paddedBottom: 0,
    paddingColor: comparisonPaddingColor,
  });
  expect([...result.image.data]).toEqual([
    177, 202, 227, 255, 255, 255, 255, 255,
  ]);
});

test("difference and overlay images keep the comparison dimensions", () => {
  const reference = image([10, 20, 30, 255, 40, 50, 60, 255]);
  const candidate = image([20, 40, 60, 255, 60, 80, 100, 255]);

  expect(makeAbsoluteRgbDifference(reference, candidate)).toEqual({
    width: 2,
    height: 1,
    data: new Uint8Array([10, 20, 30, 255, 20, 30, 40, 255]),
  });
  expect(makeFiftyFiftyOverlay(reference, candidate)).toEqual({
    width: 2,
    height: 1,
    data: new Uint8Array([15, 30, 45, 255, 50, 65, 80, 255]),
  });
});

test("metric regions use the chosen physical reference geometry", () => {
  const regions = accountMetricRegionsByScreen([
    { screen: "profile", width: 2560, height: 1419 },
    { screen: "billing", width: 2560, height: 2015 },
  ]);

  expect(accountMetricRegionGeometry).toMatchObject({
    coordinateSpace: "reference-physical-pixels",
    interpretation: "chosen",
    referencePhysicalWidth: 2560,
    scale: 1.28,
    sidebarBoundary: 689,
    headerBoundary: 241,
  });
  expect(regions).toEqual({
    profile: {
      header: { x: 0, y: 0, width: 2560, height: 241 },
      sidebar: { x: 0, y: 241, width: 689, height: 1178 },
      content: { x: 689, y: 241, width: 1871, height: 1178 },
    },
    billing: {
      header: { x: 0, y: 0, width: 2560, height: 241 },
      sidebar: { x: 0, y: 241, width: 689, height: 1774 },
      content: { x: 689, y: 241, width: 1871, height: 1774 },
    },
  });
});
