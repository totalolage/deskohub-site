import Negotiator from "negotiator";

/**
 * The offered media type the request's `Accept` header prefers, by quality
 * and specificity (RFC 9110). Ties go to the earlier offer, so the first one
 * also serves requests without an `Accept` header. `undefined` when the
 * header accepts none of them.
 */
export const preferredMediaType = <const MediaType extends string>(
  headers: Headers,
  offered: readonly [MediaType, ...MediaType[]]
): MediaType | undefined => {
  const accept = headers.get("accept");
  const preferred = new Negotiator({
    headers: accept === null ? {} : { accept },
  }).mediaType([...offered]);
  return offered.find((mediaType) => mediaType === preferred);
};
