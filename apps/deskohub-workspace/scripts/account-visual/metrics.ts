export type RgbaImage = {
  readonly width: number;
  readonly height: number;
  readonly data: Uint8Array;
};

export type RgbaColor = {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
};

export type ImageRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

export type RgbMetrics = {
  readonly meanAbsoluteRgbError: number;
  readonly mismatchPercentage: number;
  readonly maxChannelDelta: number;
  readonly pixelCount: number;
};

export type ComparisonImages = {
  readonly metrics: RgbMetrics;
  readonly difference: RgbaImage;
  readonly overlay: RgbaImage;
};

export type TopLeftPlacement = {
  readonly sourceWidth: number;
  readonly sourceHeight: number;
  readonly targetWidth: number;
  readonly targetHeight: number;
  readonly copiedWidth: number;
  readonly copiedHeight: number;
  readonly croppedRight: number;
  readonly croppedBottom: number;
  readonly paddedRight: number;
  readonly paddedBottom: number;
  readonly paddingColor: RgbaColor;
};

export const comparisonPaddingColor = {
  r: 255,
  g: 255,
  b: 255,
  a: 255,
} as const satisfies RgbaColor;

export const accountMetricRegionGeometry = {
  coordinateSpace: "reference-physical-pixels",
  interpretation: "chosen",
  source: {
    metadata: "unknown",
    previousRenderedWidth: 2000,
    previousSidebarBoundary: 538,
    previousHeaderBoundary: 188,
  },
  referencePhysicalWidth: 2560,
  scale: 1.28,
  sidebarBoundary: 689,
  headerBoundary: 241,
  rounding: "Math.round(previous boundary * 2560 / 2000)",
  rationale:
    "The desktop interpretation is chosen, not original capture metadata: 1280 CSS px at DPR 2 produces 2560 physical px; a reference sidebar of about 560 physical px maps to about 280 CSS px and an input of about 84 physical px maps to about 42 CSS px. The region boundaries scale the previous 2000-pixel view estimates to physical reference pixels.",
} as const;

const roundMetric = (value: number) =>
  Math.round(value * 1_000_000) / 1_000_000;

const assertImageData = (image: RgbaImage) => {
  const expectedLength = image.width * image.height * 4;
  if (image.data.length !== expectedLength) {
    throw new Error("RGBA image data length does not match its dimensions");
  }
};

const assertSameDimensions = (first: RgbaImage, second: RgbaImage) => {
  if (first.width !== second.width || first.height !== second.height) {
    throw new Error(
      `RGB comparison requires equal dimensions; received ${first.width}x${first.height} and ${second.width}x${second.height}`
    );
  }
};

const pixelOffset = (x: number, y: number, width: number) =>
  (y * width + x) * 4;

const clipRect = (rect: ImageRect, image: RgbaImage): ImageRect => {
  const left = Math.max(0, Math.min(image.width, rect.x));
  const top = Math.max(0, Math.min(image.height, rect.y));
  const right = Math.max(left, Math.min(image.width, rect.x + rect.width));
  const bottom = Math.max(top, Math.min(image.height, rect.y + rect.height));
  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
  };
};

export const calculateRgbMetrics = (
  reference: RgbaImage,
  candidate: RgbaImage,
  requestedRect?: ImageRect
): RgbMetrics => {
  assertImageData(reference);
  assertImageData(candidate);
  assertSameDimensions(reference, candidate);
  const rect = clipRect(
    requestedRect ?? {
      x: 0,
      y: 0,
      width: reference.width,
      height: reference.height,
    },
    reference
  );
  let absoluteChannelTotal = 0;
  let mismatchPixels = 0;
  let maxChannelDelta = 0;

  for (let y = rect.y; y < rect.y + rect.height; y += 1) {
    for (let x = rect.x; x < rect.x + rect.width; x += 1) {
      const offset = pixelOffset(x, y, reference.width);
      const redDelta = Math.abs(
        reference.data[offset]! - candidate.data[offset]!
      );
      const greenDelta = Math.abs(
        reference.data[offset + 1]! - candidate.data[offset + 1]!
      );
      const blueDelta = Math.abs(
        reference.data[offset + 2]! - candidate.data[offset + 2]!
      );
      const pixelMax = Math.max(redDelta, greenDelta, blueDelta);
      absoluteChannelTotal += redDelta + greenDelta + blueDelta;
      maxChannelDelta = Math.max(maxChannelDelta, pixelMax);
      if (pixelMax > 16) mismatchPixels += 1;
    }
  }

  const pixelCount = rect.width * rect.height;
  return {
    meanAbsoluteRgbError: roundMetric(
      pixelCount === 0 ? 0 : absoluteChannelTotal / (pixelCount * 3)
    ),
    mismatchPercentage: roundMetric(
      pixelCount === 0 ? 0 : (mismatchPixels / pixelCount) * 100
    ),
    maxChannelDelta,
    pixelCount,
  };
};

export const makeAbsoluteRgbDifference = (
  reference: RgbaImage,
  candidate: RgbaImage
): RgbaImage => {
  assertImageData(reference);
  assertImageData(candidate);
  assertSameDimensions(reference, candidate);
  const data = new Uint8Array(reference.data.length);

  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = Math.abs(reference.data[offset]! - candidate.data[offset]!);
    data[offset + 1] = Math.abs(
      reference.data[offset + 1]! - candidate.data[offset + 1]!
    );
    data[offset + 2] = Math.abs(
      reference.data[offset + 2]! - candidate.data[offset + 2]!
    );
    data[offset + 3] = 255;
  }

  return { width: reference.width, height: reference.height, data };
};

export const makeFiftyFiftyOverlay = (
  reference: RgbaImage,
  candidate: RgbaImage
): RgbaImage => {
  assertImageData(reference);
  assertImageData(candidate);
  assertSameDimensions(reference, candidate);
  const data = new Uint8Array(reference.data.length);

  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = Math.round(
      (reference.data[offset]! + candidate.data[offset]!) / 2
    );
    data[offset + 1] = Math.round(
      (reference.data[offset + 1]! + candidate.data[offset + 1]!) / 2
    );
    data[offset + 2] = Math.round(
      (reference.data[offset + 2]! + candidate.data[offset + 2]!) / 2
    );
    data[offset + 3] = 255;
  }

  return { width: reference.width, height: reference.height, data };
};

export const makeTopLeftComparisonCanvas = (
  source: RgbaImage,
  target: { readonly width: number; readonly height: number },
  paddingColor: RgbaColor = comparisonPaddingColor
): { readonly image: RgbaImage; readonly placement: TopLeftPlacement } => {
  assertImageData(source);
  const data = new Uint8Array(target.width * target.height * 4);
  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset] = paddingColor.r;
    data[offset + 1] = paddingColor.g;
    data[offset + 2] = paddingColor.b;
    data[offset + 3] = paddingColor.a;
  }

  const copiedWidth = Math.min(source.width, target.width);
  const copiedHeight = Math.min(source.height, target.height);
  for (let y = 0; y < copiedHeight; y += 1) {
    for (let x = 0; x < copiedWidth; x += 1) {
      const sourceOffset = pixelOffset(x, y, source.width);
      const targetOffset = pixelOffset(x, y, target.width);
      const sourceAlpha = source.data[sourceOffset + 3]! / 255;
      const backgroundAlpha = 1 - sourceAlpha;
      data[targetOffset] = Math.round(
        source.data[sourceOffset]! * sourceAlpha +
          paddingColor.r * backgroundAlpha
      );
      data[targetOffset + 1] = Math.round(
        source.data[sourceOffset + 1]! * sourceAlpha +
          paddingColor.g * backgroundAlpha
      );
      data[targetOffset + 2] = Math.round(
        source.data[sourceOffset + 2]! * sourceAlpha +
          paddingColor.b * backgroundAlpha
      );
      data[targetOffset + 3] = 255;
    }
  }

  return {
    image: { width: target.width, height: target.height, data },
    placement: {
      sourceWidth: source.width,
      sourceHeight: source.height,
      targetWidth: target.width,
      targetHeight: target.height,
      copiedWidth,
      copiedHeight,
      croppedRight: source.width - copiedWidth,
      croppedBottom: source.height - copiedHeight,
      paddedRight: target.width - copiedWidth,
      paddedBottom: target.height - copiedHeight,
      paddingColor,
    },
  };
};

export const accountMetricRegionRects = (width: number, height: number) =>
  (() => {
    const scale = width / accountMetricRegionGeometry.referencePhysicalWidth;
    const sidebarBoundary = Math.min(
      width,
      Math.max(
        0,
        Math.round(accountMetricRegionGeometry.sidebarBoundary * scale)
      )
    );
    const headerBoundary = Math.min(
      height,
      Math.max(
        0,
        Math.round(accountMetricRegionGeometry.headerBoundary * scale)
      )
    );
    return {
      header: { x: 0, y: 0, width, height: headerBoundary },
      sidebar: {
        x: 0,
        y: headerBoundary,
        width: sidebarBoundary,
        height: Math.max(0, height - headerBoundary),
      },
      content: {
        x: sidebarBoundary,
        y: headerBoundary,
        width: Math.max(0, width - sidebarBoundary),
        height: Math.max(0, height - headerBoundary),
      },
    } as const satisfies Record<string, ImageRect>;
  })();

export const accountMetricRegionsByScreen = (
  references: ReadonlyArray<{
    readonly screen: string;
    readonly width: number;
    readonly height: number;
  }>
) =>
  Object.fromEntries(
    references.map(({ screen, width, height }) => [
      screen,
      accountMetricRegionRects(width, height),
    ])
  );

export const calculateRegionMetrics = (
  reference: RgbaImage,
  candidate: RgbaImage
) => {
  const regions = accountMetricRegionRects(reference.width, reference.height);
  return {
    header: calculateRgbMetrics(reference, candidate, regions.header),
    sidebar: calculateRgbMetrics(reference, candidate, regions.sidebar),
    content: calculateRgbMetrics(reference, candidate, regions.content),
  };
};
