/**
 * IndexNow key, public by design. Search engines fetch it from
 * `indexNowKeyPathname` to confirm that a submission comes from this site.
 * The route serving it is named after the key, so rotating the key renames
 * `app/<key>.txt`.
 */
export const indexNowKey = "bb86fb1b2a02d5674595ff1bb263091c";

/** Site-root key file, which lets the key cover every URL on the host. */
export const indexNowKeyPathname = `/${indexNowKey}.txt`;
