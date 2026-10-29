import type { Page, Request } from "@playwright/test";
import { redactDiagnosticText } from "./redaction";
import { workspaceE2ETimeouts } from "./timeouts";

/**
 * Request groups a failure reports on, each matched by its URL and Playwright
 * resource type, such as `script` or `document`.
 */
export type WatchedRequests = Readonly<
  Record<string, (url: URL, resourceType: string) => boolean>
>;

type RequestRecord = {
  readonly group: string;
  readonly pathname: string;
  readonly startedAt: number;
  status?: number;
  failure?: string;
  settledAt?: number;
};

/** A group this small lists every request; a larger one only its problems. */
const listedGroupSize = 3;
const maximumMessages = 10;

/**
 * Records what a Playwright test's page did, so a failed wait can say why:
 * uncaught page errors, console errors, and the outcome and timing of each
 * watched request. Attach it before navigating. Everything is redacted, and
 * requests are named by pathname only.
 */
export const watchPageDiagnostics = (page: Page, watched: WatchedRequests) => {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const requests = new Map<Request, RequestRecord>();

  page.on("pageerror", (error) =>
    pageErrors.push(redactDiagnosticText(`${error.name}: ${error.message}`))
  );
  page.on("console", (message) => {
    if (message.type() === "error")
      consoleErrors.push(redactDiagnosticText(message.text()));
  });
  page.on("request", (request) => {
    const url = URL.parse(request.url());
    const group =
      url &&
      Object.entries(watched).find(([, matches]) =>
        matches(url, request.resourceType())
      )?.[0];
    if (url && group)
      requests.set(request, {
        group,
        pathname: url.pathname,
        startedAt: Date.now(),
      });
  });
  page.on("response", (response) => {
    const record = requests.get(response.request());
    if (record) record.status = response.status();
  });
  page.on("requestfinished", (request) => {
    const record = requests.get(request);
    if (record) record.settledAt = Date.now();
  });
  page.on("requestfailed", (request) => {
    const record = requests.get(request);
    if (!record) return;
    record.settledAt = Date.now();
    record.failure = redactDiagnosticText(
      request.failure()?.errorText ?? "unknown"
    );
  });

  return {
    /** Every uncaught page error so far, redacted. */
    pageErrors: (): readonly string[] => [...pageErrors],
    /**
     * Describes the page errors, console errors, watched requests, and the
     * document's state: its `readyState`, whether the Next.js runtime
     * started, and the type of each named global.
     */
    describe: async (globals: readonly string[] = []) =>
      [
        section("Page errors", pageErrors),
        section("Console errors", consoleErrors),
        ...Object.keys(watched).map((group) =>
          describeGroup(
            group,
            [...requests.values()].filter((record) => record.group === group)
          )
        ),
        `Page state: ${await readPageState(page, globals)}`,
      ].join("\n"),
  };
};

const section = (title: string, messages: readonly string[]) => {
  if (messages.length === 0) return `${title}: none`;
  const shown = messages.slice(0, maximumMessages);
  const more =
    messages.length > shown.length
      ? [`  … ${messages.length - shown.length} more`]
      : [];
  return [
    `${title}:`,
    ...shown.map((message) => `  - ${message.slice(0, 300)}`),
    ...more,
  ].join("\n");
};

const describeGroup = (group: string, records: readonly RequestRecord[]) => {
  if (records.length === 0) return `${group}: no requests`;
  const listed =
    records.length <= listedGroupSize
      ? records
      : records.filter((record) => !succeeded(record));
  const unlisted = records.length - listed.length;
  return [
    `${group}: ${records.length} requests${unlisted > 0 ? `, ${unlisted} succeeded` : ""}`,
    ...listed.map((record) => `  - ${describeRequest(record)}`),
  ].join("\n");
};

const succeeded = (record: RequestRecord) =>
  record.failure === undefined &&
  record.settledAt !== undefined &&
  record.status !== undefined &&
  record.status < 400;

const describeRequest = (record: RequestRecord) => {
  const elapsed = (record.settledAt ?? Date.now()) - record.startedAt;
  return `${redactDiagnosticText(record.pathname)}: ${describeOutcome(record)} after ${elapsed} ms`;
};

const describeOutcome = (record: RequestRecord) => {
  const status =
    record.status === undefined ? "no response" : `status ${record.status}`;
  if (record.failure !== undefined)
    return `failed (${record.failure}), ${status}`;
  if (record.settledAt === undefined) return `still pending, ${status}`;
  return status;
};

const readPageState = async (page: Page, globals: readonly string[]) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(
      () => resolve("unavailable (the page did not answer)"),
      workspaceE2ETimeouts.pageDiagnosticsRead
    );
  });
  const state = page
    .evaluate((names) => {
      const nextStarted = Reflect.get(globalThis, "next") !== undefined;
      return [
        `readyState=${document.readyState}`,
        `Next.js runtime=${nextStarted ? "started" : "not started"}`,
        ...names.map(
          (name) => `${name}=${typeof Reflect.get(globalThis, name)}`
        ),
      ].join(", ");
    }, globals)
    .catch(() => "unavailable (the page could not be read)");
  try {
    return await Promise.race([state, timeout]);
  } finally {
    clearTimeout(timer);
  }
};
