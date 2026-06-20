import sharp from "sharp";

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

export interface SvgPngTextOverlay {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly width?: number;
  readonly font: string;
  readonly fontfile?: string;
  readonly color?: string;
}

export interface SvgPngBufferOptions {
  readonly textOverlays?: readonly SvgPngTextOverlay[];
}

export const staticMapDefaults = {
  zoom: 16,
  quality: 84,
} as const;

export async function generateSvgPngBuffer(
  svg: string | Buffer,
  options: SvgPngBufferOptions = {}
) {
  const base = await sharp(Buffer.isBuffer(svg) ? svg : Buffer.from(svg))
    .png()
    .toBuffer();

  if (!options.textOverlays?.length) return base;

  const textOverlays = await Promise.all(
    options.textOverlays.map(createTextOverlay)
  );

  return sharp(base).composite(textOverlays).png().toBuffer();
}

const escapePangoText = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

async function createTextOverlay(
  overlay: SvgPngTextOverlay
): Promise<sharp.OverlayOptions> {
  const renderedText = await sharp({
    text: {
      text: overlay.color
        ? `<span foreground="${overlay.color}">${escapePangoText(overlay.text)}</span>`
        : escapePangoText(overlay.text),
      font: overlay.font,
      fontfile: overlay.fontfile,
      width: overlay.width,
      align: "center",
      rgba: true,
    },
  })
    .png()
    .toBuffer({ resolveWithObject: true });

  return {
    input: renderedText.data,
    left: Math.round(overlay.x - renderedText.info.width / 2),
    top: Math.round(overlay.y - renderedText.info.height / 2),
  };
}

interface TileCoordinate {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

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

const fetchTile = async (
  tileUrl: string,
  userAgent: string,
  tile: TileCoordinate
) => {
  const response = await fetch(buildTileUrl(tileUrl, tile), {
    headers: { "User-Agent": userAgent },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch OSM tile ${tile.z}/${tile.x}/${tile.y}: ${response.status} ${response.statusText}`
    );
  }

  return Buffer.from(await response.arrayBuffer());
};

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

export async function generateStaticMapImage(options: StaticMapImageOptions) {
  const tileSize = options.tileSize ?? defaultTileSize;
  const tileUrl = options.tileUrl ?? defaultTileUrl;
  const userAgent = options.userAgent ?? defaultUserAgent;
  const quality = options.quality ?? staticMapDefaults.quality;
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
  const composites: sharp.OverlayOptions[] = [];

  for (let y = startTileY; y <= endTileY; y += 1) {
    if (y < 0 || y >= tileCount) continue;

    for (let x = startTileX; x <= endTileX; x += 1) {
      const tile = {
        x: normalizeTileX(x, options.zoom),
        y,
        z: options.zoom,
      };

      composites.push({
        input: await fetchTile(tileUrl, userAgent, tile),
        left: (x - startTileX) * tileSize,
        top: (y - startTileY) * tileSize,
      });
    }
  }

  const baseWidth = (endTileX - startTileX + 1) * tileSize;
  const baseHeight = (endTileY - startTileY + 1) * tileSize;
  const extractLeft = Math.round(left - startTileX * tileSize);
  const extractTop = Math.round(top - startTileY * tileSize);
  const tiledMap = await sharp({
    create: {
      width: baseWidth,
      height: baseHeight,
      channels: 3,
      background: "#f4f1ea",
    },
  })
    .composite(composites)
    .png()
    .toBuffer();

  return sharp(tiledMap)
    .extract({
      left: extractLeft,
      top: extractTop,
      width: options.width,
      height: options.height,
    })
    .composite([
      {
        input: createMarkerSvg(options.width, options.height),
        left: 0,
        top: 0,
      },
      {
        input: createAttributionSvg(options.width, options.height),
        left: 0,
        top: 0,
      },
    ])
    .jpeg({ quality, mozjpeg: true })
    .toBuffer();
}
