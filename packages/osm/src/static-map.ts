import { Effect, Predicate } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import sharp, { type OverlayOptions } from "sharp";
import { ImageRenderingError, OsmTileRequestError } from "./errors";
import { renderTextImage } from "./text-image";

const defaultTileSize = 256;
const defaultTileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const defaultUserAgent = "DeskohubStaticMap/1.0 (+https://deskohub.cz)";
const tileRequestTimeout = "10 seconds";

export interface StaticMapImageOptions {
  readonly lat: number;
  readonly lng: number;
  readonly zoom: number;
  readonly width: number;
  readonly height: number;
  readonly tileSize?: number;
  readonly tileUrl?: string;
  readonly userAgent?: string;
  readonly quality?: number;
  /**
   * Font the OpenStreetMap attribution is drawn with. Without it the
   * attribution needs a system sans-serif font, which serverless runtimes
   * such as Vercel functions lack.
   */
  readonly attributionFont?: StaticMapAttributionFont;
  /**
   * Image pixels per displayed pixel. Enlarges the attribution so it stays
   * legible when the image is shown downscaled. Defaults to 1.
   */
  readonly attributionScale?: number;
  /**
   * Draws the attribution into the image. Defaults to true. Turn it off only
   * when the page shows the attribution over the image itself, for example
   * because the page crops the image to its viewport.
   */
  readonly attribution?: boolean;
  /** Draws the location marker at the coordinate. Defaults to true. */
  readonly marker?: boolean;
  /** The image pixel the coordinate lands on. Defaults to the image centre. */
  readonly focus?: StaticMapFocus;
  /** Defaults to JPEG. */
  readonly format?: StaticMapImageFormat;
}

interface StaticMapFocus {
  readonly x: number;
  readonly y: number;
}

type StaticMapImageFormat = "jpeg" | "webp";

export interface StaticMapAttributionFont {
  readonly file: string;
  /** Family name of the font in `file`. */
  readonly family: string;
}

const staticMapDefaults = {
  zoom: 16,
  quality: 84,
} as const;

export const generateStaticMapImage = Effect.fn("osm.generateStaticMapImage")(
  (options: StaticMapImageOptions) => {
    const input = createStaticMapInput(options);

    return Effect.succeed(input).pipe(
      Effect.bind("composites", fetchTileComposites),
      Effect.bind("tiledMap", renderTiledMap),
      Effect.bind("overlays", renderOverlays),
      Effect.bind("image", renderStaticMap),
      Effect.map(({ image }) => image)
    );
  }
);

interface TileCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface TilePlacement {
  readonly left: number;
  readonly tile: TileCoordinate;
  readonly top: number;
}

interface StaticMapInput {
  readonly attribution: boolean;
  readonly attributionFont: StaticMapAttributionFont | undefined;
  readonly attributionScale: number;
  readonly baseHeight: number;
  readonly baseWidth: number;
  readonly extractLeft: number;
  readonly extractTop: number;
  readonly focus: StaticMapFocus;
  readonly format: StaticMapImageFormat;
  readonly height: number;
  readonly marker: boolean;
  readonly quality: number;
  readonly tileUrl: string;
  readonly tiles: readonly TilePlacement[];
  readonly userAgent: string;
  readonly width: number;
}

const fetchTileComposites = ({ tiles, tileUrl, userAgent }: StaticMapInput) =>
  Effect.all(
    tiles.map(({ left, tile, top }) =>
      fetchTile({ tile, tileUrl, userAgent }).pipe(
        Effect.map((input) => ({ input, left, top }))
      )
    ),
    { concurrency: "inherit" }
  );

const renderTiledMap = ({
  baseHeight,
  baseWidth,
  composites,
}: StaticMapInput & {
  readonly composites: readonly OverlayOptions[];
}) =>
  Effect.tryPromise({
    try: () =>
      sharp({
        create: {
          width: baseWidth,
          height: baseHeight,
          channels: 3,
          background: "#f4f1ea",
        },
      })
        .composite([...composites])
        .png()
        .toBuffer(),
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "Map tiles could not be composed.",
        operation: "compose-map-tiles",
      }),
  });

// OpenStreetMap's attribution guidelines ask for this text where the map is
// shown.
const attributionText = "© OpenStreetMap contributors";
const attributionFontSize = 12;

const renderAttribution = ({
  attributionFont,
  attributionScale,
  height,
  width,
}: StaticMapInput) =>
  Effect.tryPromise({
    try: async () => {
      const text = await renderTextImage({
        text: attributionText,
        font: `${attributionFont?.family ?? "sans-serif"} ${attributionFontSize * attributionScale}`,
        fontfile: attributionFont?.file,
        color: "#00024f",
      });
      const paddingX = Math.round(8 * attributionScale);
      const paddingY = Math.round(5 * attributionScale);
      const boxWidth = text.info.width + 2 * paddingX;
      const boxHeight = text.info.height + 2 * paddingY;

      return Buffer.from(`
        <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
          <rect x="${width - boxWidth}" y="${height - boxHeight}" width="${boxWidth}" height="${boxHeight}" fill="rgba(255,255,255,0.88)"/>
          <image x="${width - boxWidth + paddingX}" y="${height - boxHeight + paddingY}" width="${text.info.width}" height="${text.info.height}" href="data:image/png;base64,${text.data.toString("base64")}"/>
        </svg>
      `);
    },
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "The map attribution could not be rendered.",
        operation: "render-map-attribution",
      }),
  });

const renderOverlays = (input: StaticMapInput) =>
  Effect.all([
    ...(input.marker
      ? [
          Effect.succeed(
            createMarkerSvg(input.width, input.height, input.focus)
          ),
        ]
      : []),
    ...(input.attribution ? [renderAttribution(input)] : []),
  ]);

const renderStaticMap = ({
  extractLeft,
  extractTop,
  format,
  height,
  overlays,
  quality,
  tiledMap,
  width,
}: StaticMapInput & {
  readonly overlays: readonly Buffer[];
  readonly tiledMap: Buffer;
}) =>
  Effect.tryPromise({
    try: () => {
      const image = sharp(tiledMap)
        .extract({
          left: extractLeft,
          top: extractTop,
          width,
          height,
        })
        .composite(overlays.map((input) => ({ input, left: 0, top: 0 })));

      return (
        format === "webp"
          ? image.webp({ quality })
          : image.jpeg({ quality, mozjpeg: true })
      ).toBuffer();
    },
    catch: (cause) =>
      new ImageRenderingError({
        cause,
        message: "The static map image could not be encoded.",
        operation: "encode-static-map",
      }),
  });

const fetchTile = Effect.fn("osm.fetchTile")(
  ({
    tile,
    tileUrl,
    userAgent,
  }: {
    readonly tile: TileCoordinate;
    readonly tileUrl: string;
    readonly userAgent: string;
  }) => {
    const url = buildTileUrl(tileUrl, tile);
    const request = HttpClientRequest.get(url).pipe(
      HttpClientRequest.setHeader("User-Agent", userAgent)
    );

    return HttpClient.execute(request).pipe(
      // Trace headers would leak internal span IDs to the tile server and make
      // every request for the same tile unique, defeating HTTP tile caches.
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
      Effect.filterOrFail(
        ({ status }) => status >= 200 && status < 300,
        ({ status }) =>
          new OsmTileRequestError({
            message: `OpenStreetMap tile ${tile.z}/${tile.x}/${tile.y} returned HTTP ${status}.`,
            statusCode: status,
            url,
            ...tile,
          })
      ),
      Effect.flatMap((response) => response.arrayBuffer),
      Effect.map((body) => Buffer.from(body)),
      Effect.mapError((cause) =>
        Predicate.isTagged(cause, "OsmTileRequestError")
          ? cause
          : new OsmTileRequestError({
              cause,
              message: `OpenStreetMap tile ${tile.z}/${tile.x}/${tile.y} could not be downloaded.`,
              url,
              ...tile,
            })
      ),
      Effect.timeoutOrElse({
        duration: tileRequestTimeout,
        orElse: () =>
          Effect.fail(
            new OsmTileRequestError({
              message: `OpenStreetMap tile ${tile.z}/${tile.x}/${tile.y} timed out.`,
              url,
              ...tile,
            })
          ),
      })
    );
  }
);

const createStaticMapInput = (
  options: StaticMapImageOptions
): StaticMapInput => {
  const tileSize = options.tileSize ?? defaultTileSize;
  const viewport = createStaticMapViewport(options, tileSize);
  const look = resolveStaticMapLook(options);

  return {
    attribution: look.attribution,
    attributionFont: look.attributionFont,
    attributionScale: look.attributionScale,
    baseWidth: (viewport.endTileX - viewport.startTileX + 1) * tileSize,
    baseHeight: (viewport.endTileY - viewport.startTileY + 1) * tileSize,
    extractLeft: viewport.left - viewport.startTileX * tileSize,
    extractTop: viewport.top - viewport.startTileY * tileSize,
    focus: viewport.focus,
    format: look.format,
    height: options.height,
    marker: look.marker,
    quality: look.quality,
    tileUrl: options.tileUrl ?? defaultTileUrl,
    tiles: placeViewportTiles(viewport, options.zoom, tileSize),
    userAgent: options.userAgent ?? defaultUserAgent,
    width: options.width,
  };
};

interface StaticMapViewport {
  readonly endTileX: number;
  readonly endTileY: number;
  readonly focus: StaticMapFocus;
  readonly left: number;
  readonly startTileX: number;
  readonly startTileY: number;
  readonly top: number;
}

/** Positions the image over the world pixels and finds the tiles it spans. */
const createStaticMapViewport = (
  options: StaticMapImageOptions,
  tileSize: number
): StaticMapViewport => {
  const center = coordinateToGlobalPixel(
    options.lat,
    options.lng,
    options.zoom,
    tileSize
  );
  const focus = options.focus ?? {
    x: options.width / 2,
    y: options.height / 2,
  };
  // Snap the viewport to whole pixels before choosing tiles, so the crop
  // offset and the tile range agree and the crop stays inside the canvas.
  const left = Math.round(center.x - focus.x);
  const top = Math.round(center.y - focus.y);

  return {
    endTileX: Math.floor((left + options.width - 1) / tileSize),
    endTileY: Math.floor((top + options.height - 1) / tileSize),
    focus,
    left,
    startTileX: Math.floor(left / tileSize),
    startTileY: Math.floor(top / tileSize),
    top,
  };
};

/**
 * Places each tile the viewport spans, skipping rows beyond the poles and
 * wrapping columns around the antimeridian.
 */
const placeViewportTiles = (
  { endTileX, endTileY, startTileX, startTileY }: StaticMapViewport,
  zoom: number,
  tileSize: number
): TilePlacement[] => {
  const tileCount = 2 ** zoom;
  const tiles: TilePlacement[] = [];

  for (let y = startTileY; y <= endTileY; y += 1) {
    if (y < 0 || y >= tileCount) continue;

    for (let x = startTileX; x <= endTileX; x += 1) {
      tiles.push({
        tile: {
          x: normalizeTileX(x, zoom),
          y,
          z: zoom,
        },
        left: (x - startTileX) * tileSize,
        top: (y - startTileY) * tileSize,
      });
    }
  }

  return tiles;
};

/** Resolves what the rendered image draws and how it is encoded. */
const resolveStaticMapLook = (options: StaticMapImageOptions) => ({
  attribution: options.attribution ?? true,
  attributionFont: options.attributionFont,
  attributionScale: options.attributionScale ?? 1,
  format: options.format ?? "jpeg",
  marker: options.marker ?? true,
  quality: options.quality ?? staticMapDefaults.quality,
});

const degreesToRadians = (degrees: number) => (degrees * Math.PI) / 180;

const normalizeTileX = (x: number, zoom: number) => {
  const tileCount = 2 ** zoom;
  return ((x % tileCount) + tileCount) % tileCount;
};

const coordinateToGlobalPixel = (
  lat: number,
  lng: number,
  zoom: number,
  tileSize: number
) => {
  const latitude = degreesToRadians(lat);
  const tileCount = 2 ** zoom;
  const x = ((lng + 180) / 360) * tileCount * tileSize;
  const y =
    ((1 - Math.log(Math.tan(latitude) + 1 / Math.cos(latitude)) / Math.PI) /
      2) *
    tileCount *
    tileSize;

  return { x, y };
};

const buildTileUrl = (template: string, { x, y, z }: TileCoordinate): string =>
  template
    .replaceAll("{x}", String(x))
    .replaceAll("{y}", String(y))
    .replaceAll("{z}", String(z));

const createMarkerSvg = (
  width: number,
  height: number,
  focus: StaticMapFocus
) => {
  const markerWidth = 56;
  const markerHeight = 72;
  const left = focus.x - markerWidth / 2;
  const top = focus.y - markerHeight;

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${left} ${top})" filter="drop-shadow(0 8px 12px rgba(0, 2, 79, 0.35))">
        <path d="M28 70C28 70 52 42.5 52 24C52 10.745 41.255 0 28 0C14.745 0 4 10.745 4 24C4 42.5 28 70 28 70Z" fill="#006b55"/>
        <circle cx="28" cy="24" r="11" fill="#f4f1ea"/>
      </g>
    </svg>
  `);
};
