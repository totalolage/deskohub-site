/**
 * Keeps a response out of search results. Robots.txt admits every crawler, so
 * machine-readable files that crawlers fetch, such as `llms.txt`, say so
 * themselves.
 */
export const markUnindexedResponse = <T extends Response>(response: T) => {
  response.headers.set("X-Robots-Tag", "noindex");
  return response;
};
