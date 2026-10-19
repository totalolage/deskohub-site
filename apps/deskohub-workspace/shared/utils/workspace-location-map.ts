import { workspaceSiteConstants } from "./site-constants";

const workspaceAddress = workspaceSiteConstants.location.address;
const workspaceCoordinates = workspaceSiteConstants.location.coordinates;

export const workspaceFormattedAddress = `${workspaceAddress.street}, ${workspaceAddress.postalCode} ${workspaceAddress.city} - ${workspaceAddress.cityDistrict}`;

export const workspaceGoogleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${workspaceCoordinates.lat},${workspaceCoordinates.lng}`;

export const workspaceLocationMapImagePath = "/workspace-location-map.jpeg";

// The reservation email shows the map at this width.
export const workspaceLocationMapEmailWidth = 534;

const workspaceLocationMapWidth = 2400;

export const workspaceLocationMapImageOptions = {
  lat: workspaceCoordinates.lat,
  lng: workspaceCoordinates.lng,
  width: workspaceLocationMapWidth,
  height: 1280,
  zoom: 17,
  quality: 84,
  // Keeps the OpenStreetMap attribution legible in the email.
  attributionScale: workspaceLocationMapWidth / workspaceLocationMapEmailWidth,
} as const;
