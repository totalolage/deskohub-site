/**
 * Child-process preload for submit-indexnow CLI tests. It answers the
 * production sitemap with `INDEXNOW_FIXTURE_SITEMAP_STATUS` and the
 * `INDEXNOW_FIXTURE_SITEMAP` body, and the IndexNow endpoint with
 * `INDEXNOW_FIXTURE_STATUS`, or a transport failure when that is
 * `unreachable`. Each IndexNow request's content type and body are appended
 * as a JSON line to `INDEXNOW_FIXTURE_RECORD`. Any other request fails.
 */
import { appendFileSync } from "node:fs";

const sitemapUrl = "https://workspace.deskohub.cz/sitemap.xml";
const indexNowUrl = "https://api.indexnow.org/indexnow";

const recordFile = process.env.INDEXNOW_FIXTURE_RECORD;
if (!recordFile) {
  throw new Error("The IndexNow fixture needs INDEXNOW_FIXTURE_RECORD");
}

const fixtureFetch = async (
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> => {
  const request = new Request(input, init);
  if (request.method === "GET" && request.url === sitemapUrl) {
    return new Response(process.env.INDEXNOW_FIXTURE_SITEMAP ?? "", {
      status: Number(process.env.INDEXNOW_FIXTURE_SITEMAP_STATUS ?? "200"),
      headers: { "Content-Type": "application/xml" },
    });
  }
  if (request.method === "POST" && request.url === indexNowUrl) {
    appendFileSync(
      recordFile,
      `${JSON.stringify({
        contentType: request.headers.get("Content-Type"),
        body: await request.text(),
      })}\n`
    );
    if (process.env.INDEXNOW_FIXTURE_STATUS === "unreachable") {
      throw new TypeError("fetch failed");
    }
    return new Response(null, {
      status: Number(process.env.INDEXNOW_FIXTURE_STATUS),
    });
  }
  throw new Error(
    `Unexpected request in the IndexNow fixture: ${request.method} ${request.url}`
  );
};

globalThis.fetch = Object.assign(fixtureFetch, {
  preconnect: globalThis.fetch.preconnect,
});
