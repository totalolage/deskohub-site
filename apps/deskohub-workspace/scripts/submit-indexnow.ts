/**
 * Submits the published public pages to IndexNow after a production release,
 * so Bing (and through it Copilot) and Seznam pick up changes quickly.
 *
 * The production sitemap is the published projection of the public-page
 * registry: it lists both locales' canonical URLs and leaves out pages whose
 * release gate is off, which this release job can't evaluate. A failed
 * submission only warns; it never fails the release.
 */
import { Console, Data, Effect, Schedule } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
} from "effect/unstable/http";
import { indexNowKey, indexNowKeyPathname } from "@/features/public-pages";
import { runStandaloneWorkspaceEffect } from "@/shared/backend/standalone-workspace-effect";
import {
  getWorkspaceCanonicalUrl,
  workspaceSiteConstants,
  workspaceSiteOrigin,
} from "@/shared/utils/site-constants";

/** Shared endpoint that forwards each submission to every IndexNow engine. */
const indexNowEndpoint = "https://api.indexnow.org/indexnow";

/** 200 records the URLs; 202 records them while the key check is pending. */
const acceptedStatuses: ReadonlySet<number> = new Set([200, 202]);

const sitemapLocation = /<loc>([^<]+)<\/loc>/g;

class IndexNowSubmissionError extends Data.TaggedError(
  "IndexNowSubmissionError"
)<{
  readonly message: string;
  readonly status?: number;
  readonly cause?: unknown;
}> {}

interface IndexNowSubmission {
  readonly host: string;
  readonly key: string;
  readonly keyLocation: string;
  readonly urlList: ReadonlyArray<string>;
}

const submitPublishedPages = Effect.Do.pipe(
  Effect.bind("urlList", readPublishedPageUrls),
  Effect.let("submission", buildSubmission),
  Effect.bind("status", postSubmission),
  Effect.map(({ status, submission }) => ({
    status,
    host: submission.host,
    urlCount: submission.urlList.length,
  })),
  Effect.withSpan("IndexNow.submitPublishedPages")
);

function readPublishedPageUrls() {
  return HttpClient.HttpClient.pipe(
    Effect.map((client) =>
      client.pipe(
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          times: 2,
          schedule: Schedule.exponential("500 millis"),
        })
      )
    ),
    Effect.flatMap((client) =>
      client.get(getWorkspaceCanonicalUrl("/sitemap.xml"))
    ),
    Effect.flatMap((response) => response.text),
    Effect.timeout("20 seconds"),
    Effect.mapError(
      (cause) =>
        new IndexNowSubmissionError({
          message: "The production sitemap could not be read",
          cause,
        })
    ),
    Effect.map(canonicalSitemapUrls),
    Effect.filterOrFail(
      (urls) => urls.length > 0,
      () =>
        new IndexNowSubmissionError({
          message: "The production sitemap lists no canonical page",
        })
    )
  );
}

/** Page URLs the sitemap lists on the canonical production origin. */
function canonicalSitemapUrls(sitemap: string): ReadonlyArray<string> {
  return Array.from(sitemap.matchAll(sitemapLocation), ([, location = ""]) =>
    location.trim()
  ).filter(
    (location) =>
      URL.canParse(location) && new URL(location).origin === workspaceSiteOrigin
  );
}

function buildSubmission({
  urlList,
}: {
  readonly urlList: ReadonlyArray<string>;
}): IndexNowSubmission {
  return {
    host: workspaceSiteConstants.brand.domain,
    key: indexNowKey,
    keyLocation: getWorkspaceCanonicalUrl(indexNowKeyPathname),
    urlList,
  };
}

function postSubmission({
  submission,
}: {
  readonly submission: IndexNowSubmission;
}) {
  return HttpClient.HttpClient.pipe(
    Effect.flatMap((client) =>
      client.execute(
        HttpClientRequest.post(indexNowEndpoint).pipe(
          HttpClientRequest.bodyText(
            JSON.stringify(submission),
            "application/json; charset=utf-8"
          )
        )
      )
    ),
    Effect.timeout("10 seconds"),
    // The request body carries the key; keep only the failure's message,
    // which names the method and endpoint.
    Effect.mapError(
      ({ message }) =>
        new IndexNowSubmissionError({
          message: `The IndexNow request failed: ${message}`,
        })
    ),
    Effect.map(({ status }) => status),
    Effect.filterOrFail(
      (status) => acceptedStatuses.has(status),
      (status) =>
        new IndexNowSubmissionError({
          message: `IndexNow answered HTTP ${status}`,
          status,
        })
    )
  );
}

/** Surfaces the failure as a GitHub Actions warning on the release run. */
function warnSkippedSubmission({ message }: IndexNowSubmissionError) {
  return Console.log(`::warning title=IndexNow submission skipped::${message}`);
}

if (import.meta.main) {
  await submitPublishedPages.pipe(
    Effect.tap((result) =>
      Effect.logInfo("IndexNow accepted the published pages").pipe(
        Effect.annotateLogs(result)
      )
    ),
    Effect.catchTag("IndexNowSubmissionError", warnSkippedSubmission),
    Effect.provide(FetchHttpClient.layer),
    runStandaloneWorkspaceEffect("indexnow.submit")
  );
}
