/** Keeps a response out of shared caches and stops it leaking its URL as a referrer. */
export const markPrivateResponse = <T extends Response>(response: T) => {
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
};
