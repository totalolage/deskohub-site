import { Effect, Predicate } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";
import sharp from "sharp";
import { ImageRenderingError, OsmTileRequestError } from "./errors";

const defaultTileSize = 256;
const defaultTileUrl = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const defaultUserAgent = "DeskohubStaticMap/1.0 (+https://deskohub.cz)";

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
}

export const staticMapDefaults = {
  zoom: 16,
  quality: 84,
} as const;

export const generateStaticMapImage = Effect.fn("osm.generateStaticMapImage")(
  (options: StaticMapImageOptions) => {
    const input = createStaticMapInput(options);

    return Effect.succeed(input).pipe(
      Effect.bind("composites", fetchTileComposites),
      Effect.bind("tiledMap", renderTiledMap),
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
  readonly baseHeight: number;
  readonly baseWidth: number;
  readonly extractLeft: number;
  readonly extractTop: number;
  readonly height: number;
  readonly quality: number;
  readonly tileUrl: string;
  readonly tiles: readonly TilePlacement[];
  readonly userAgent: string;
  readonly width: number;
}

const fetchTileComposites = ({ tiles, tileUrl, userAgent }: StaticMapInput) =>
  Effect.forEach(tiles, ({ left, tile, top }) =>
    fetchTile({ tile, tileUrl, userAgent }).pipe(
      Effect.map((input) => ({ input, left, top }))
    )
  );

const renderTiledMap = ({
  baseHeight,
  baseWidth,
  composites,
}: StaticMapInput & {
  readonly composites: readonly sharp.OverlayOptions[];
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

const renderStaticMap = ({
  extractLeft,
  extractTop,
  height,
  quality,
  tiledMap,
  width,
}: StaticMapInput & { readonly tiledMap: Buffer }) =>
  Effect.tryPromise({
    try: () =>
      sharp(tiledMap)
        .extract({
          left: extractLeft,
          top: extractTop,
          width,
          height,
        })
        .composite([
          {
            input: createMarkerSvg(width, height),
            left: 0,
            top: 0,
          },
          {
            input: createAttributionSvg(width, height),
            left: 0,
            top: 0,
          },
        ])
        .jpeg({ quality, mozjpeg: true })
        .toBuffer(),
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
      )
    );
  }
);

const createStaticMapInput = (
  options: StaticMapImageOptions
): StaticMapInput => {
  const tileSize = options.tileSize ?? defaultTileSize;
  const center = coordinateToGlobalPixel(
    options.lat,
    options.lng,
    options.zoom,
    tileSize
  );
  const left = center.x - options.width / 2;
  const top = center.y - options.height / 2;
  const startTileX = Math.floor(left / tileSize);
  const startTileY = Math.floor(top / tileSize);
  const endTileX = Math.floor((left + options.width - 1) / tileSize);
  const endTileY = Math.floor((top + options.height - 1) / tileSize);
  const tileCount = 2 ** options.zoom;
  const tiles: TilePlacement[] = [];

  for (let y = startTileY; y <= endTileY; y += 1) {
    if (y < 0 || y >= tileCount) continue;

    for (let x = startTileX; x <= endTileX; x += 1) {
      tiles.push({
        tile: {
          x: normalizeTileX(x, options.zoom),
          y,
          z: options.zoom,
        },
        left: (x - startTileX) * tileSize,
        top: (y - startTileY) * tileSize,
      });
    }
  }

  return {
    baseWidth: (endTileX - startTileX + 1) * tileSize,
    baseHeight: (endTileY - startTileY + 1) * tileSize,
    extractLeft: Math.round(left - startTileX * tileSize),
    extractTop: Math.round(top - startTileY * tileSize),
    height: options.height,
    quality: options.quality ?? staticMapDefaults.quality,
    tileUrl: options.tileUrl ?? defaultTileUrl,
    tiles,
    userAgent: options.userAgent ?? defaultUserAgent,
    width: options.width,
  };
};

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

const createMarkerSvg = (width: number, height: number) => {
  const markerWidth = 56;
  const markerHeight = 72;
  const left = width / 2 - markerWidth / 2;
  const top = height / 2 - markerHeight;

  return Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <g transform="translate(${left} ${top})" filter="drop-shadow(0 8px 12px rgba(0, 2, 79, 0.35))">
        <path d="M28 70C28 70 52 42.5 52 24C52 10.745 41.255 0 28 0C14.745 0 4 10.745 4 24C4 42.5 28 70 28 70Z" fill="#006b55"/>
        <circle cx="28" cy="24" r="11" fill="#f4f1ea"/>
      </g>
    </svg>
  `);
};

const createAttributionSvg = (width: number, height: number) =>
  Buffer.from(`
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      <rect x="${width - 196}" y="${height - 23}" width="196" height="23" fill="rgba(255,255,255,0.88)"/>
      <text x="${width - 188}" y="${height - 7}" font-family="Arial, sans-serif" font-size="12" fill="#00024f">&#169; OpenStreetMap contributors</text>
    </svg>
  `);
