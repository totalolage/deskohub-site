import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { workspaceLocationMapZoom } from "@/shared/utils/workspace-location-map";

/** From this width the location map frames the workspace for wide screens. */
export const locationMapWideMedia = "(min-width: 64rem)";

/**
 * Where the location map frames the workspace marker, as fractions of the map
 * box: beside the copy on wide screens, under it on narrower ones.
 */
export const locationMapMarkerPosition = {
  narrow: { x: 0.5, y: 0.8 },
  wide: { x: 0.75, y: 0.5 },
} as const;

/** The workspace pin, anchored at its tip. */
export const locationMapMarker = {
  svg: `<svg aria-hidden="true" width="40" height="40" viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M20 1C12.82 1 7 6.82 7 14C7 23.5 20 39 20 39C20 39 33 23.5 33 14C33 6.82 27.18 1 20 1Z" fill="#b83b06"/>
    <circle cx="20" cy="14" r="5.5" fill="#f4f1ea"/>
  </svg>`,
  size: 40,
  anchor: { x: 20, y: 39 },
} as const;

const framing = (
  width: number,
  height: number,
  markerPosition: { readonly x: number; readonly y: number }
) => ({
  width,
  height,
  focus: { x: width * markerPosition.x, y: height * markerPosition.y },
});

/**
 * The static maps the landing page shows until a visitor uses the interactive
 * map. Each is drawn at one image pixel per CSS pixel, the scale of the
 * interactive map's tiles, with the workspace at the marker position's
 * fraction of the image, so the page lines it up with the marker position.
 * Placed that way, each covers a map box up to its own size. `compact` serves
 * widths under 32rem and `medium` the rest of the narrow framing; `wide`
 * serves wide screens up to 120rem and `extra-wide` the ones beyond.
 */
export const locationMapFramings = {
  compact: framing(512, 1080, locationMapMarkerPosition.narrow),
  medium: framing(1024, 1080, locationMapMarkerPosition.narrow),
  wide: framing(1920, 800, locationMapMarkerPosition.wide),
  "extra-wide": framing(2560, 800, locationMapMarkerPosition.wide),
};

export type LocationMapFraming = keyof typeof locationMapFramings;

export const isLocationMapFraming = (
  value: string
): value is LocationMapFraming => Object.hasOwn(locationMapFramings, value);

export const locationMapFramingPath = (framing: LocationMapFraming) =>
  `/workspace-location-map/${framing}.webp`;

export const locationMapFramingImageOptions = (
  framing: LocationMapFraming
) => ({
  ...workspaceSiteConstants.location.coordinates,
  ...locationMapFramings[framing],
  zoom: workspaceLocationMapZoom,
  quality: 70,
  format: "webp" as const,
  // The page draws both over the image, where the visitor sees them.
  marker: false,
  attribution: false,
});
