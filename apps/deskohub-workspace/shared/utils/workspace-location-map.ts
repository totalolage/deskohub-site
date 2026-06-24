import { workspaceSiteConstants } from "./site-constants";

const workspaceAddress = workspaceSiteConstants.contact.address;
const workspaceCoordinates = workspaceSiteConstants.contact.coordinates;

export const workspaceFormattedAddress = `${workspaceAddress.street}, ${workspaceAddress.postalCode} ${workspaceAddress.city} - ${workspaceAddress.cityDistrict}`;

export const workspaceGoogleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${workspaceCoordinates.lat},${workspaceCoordinates.lng}`;

export const workspaceLocationMapImagePath = "/workspace-location-map.jpeg";

export const workspaceLocationMapImageOptions = {
  lat: workspaceCoordinates.lat,
  lng: workspaceCoordinates.lng,
  width: 2400,
  height: 1280,
  zoom: 17,
  quality: 84,
} as const;
