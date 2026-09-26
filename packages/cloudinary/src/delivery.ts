import type { CloudinaryAsset } from "./schema";

/**
 * Derives the versioned secure delivery URL for an asset from its own data.
 *
 * Callers must prefer the version recorded on a freshly fetched or returned
 * asset over a cached URL so a promoted avatar never serves a stale CDN copy.
 * When the asset carries no version, the provider's secure URL is returned
 * unchanged.
 */
export function buildVersionedDeliveryUrl(asset: CloudinaryAsset): string {
  return withDeliveryVersion(asset.secure_url, asset.version);
}

export function withDeliveryVersion(
  secureUrl: string,
  version: CloudinaryAsset["version"]
): string {
  if (version === undefined) {
    return secureUrl;
  }

  const uploadMarker = "/upload/";
  const markerIndex = secureUrl.indexOf(uploadMarker);

  if (markerIndex === -1) {
    return secureUrl;
  }

  const afterUpload = secureUrl.slice(markerIndex + uploadMarker.length);
  const versionSegment = `v${version}/`;

  if (afterUpload.startsWith(versionSegment)) {
    return secureUrl;
  }

  return `${secureUrl.slice(0, markerIndex + uploadMarker.length)}${versionSegment}${afterUpload}`;
}
