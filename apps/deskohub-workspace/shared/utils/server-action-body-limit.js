/**
 * The largest request body a Server Action accepts, in bytes. Uploads carry
 * their raw bytes plus the multipart envelope, so the 1 MiB default is too
 * small for images. Vercel Functions refuse request bodies over 4.5 MB, so the
 * limit can't grow much past this.
 */
export const serverActionBodySizeLimitBytes = 4 * 1024 * 1024;
