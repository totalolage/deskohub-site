import { describe, expect, test } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { createCensoredOtelSpanExporter } from "../../shared/backend/logging/censorship";
import { createTracingLive } from "../../shared/backend/observability/otel-tracing";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import {
  makeTestE2EEnvironment,
  validE2ERuntimeEnvironment,
} from "../e2e-env.test-fixture";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import { redact } from "../runtime";
import {
  E2ERunContextService,
  E2ETelemetryService,
} from "../services/telemetry";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
} from "./config";
import {
  resolveWorkspaceE2EPreviewLogs,
  type WorkspaceE2EMagicLinkRequest,
} from "./vercel-log-retrieval";

const config = getAccountE2EConfig(
  makeWorkspaceE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    WORKSPACE_E2E_VERCEL_PROJECT: "workspace-preview-project",
    WORKSPACE_E2E_VERCEL_TOKEN: "vercel-log-read-token",
  }),
  Schema.decodeUnknownSync(workspaceE2ERunIdSchema)("1234567890-2")
);

const recipient = makeWorkspaceE2EAccountRecipient(config, "retrieval");
const expectedHost = config.expectedHost;
const authOrigin = `https://${expectedHost}`;
const callbackPath = `/${config.locale}/auth/callback`;
const deployment = {
  id: "dpl-synthetic",
  ownerId: "team-synthetic",
  projectId: "workspace-preview-project",
};

const magicLinkWithCallback = (token: string, callback: string) =>
  `${authOrigin}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callback)}`;

const magicLink = (token: string) => magicLinkWithCallback(token, callbackPath);

const previewE2ELine = (text: string, recipientOverride?: string | null) =>
  JSON.stringify({
    code: "account.magic-link.preview-e2e",
    ...(recipientOverride === null
      ? {}
      : { recipient: recipientOverride ?? recipient }),
    message: "Synthetic preview magic-link text body for E2E retrieval.",
    text,
  });

type LogRow = Record<string, unknown>;
type FetchHandler = (
  request: Request,
  historyCall: number
) => Response | Promise<Response>;

const log = (message: unknown, messageTruncated?: unknown): LogRow => ({
  message,
  ...(messageTruncated === undefined ? {} : { messageTruncated }),
});

const row = (
  requestId: string,
  logs: readonly LogRow[],
  overrides: LogRow = {}
): LogRow => ({
  deploymentId: deployment.id,
  logs,
  requestId,
  timestamp: "2026-10-01T12:00:00.001Z",
  ...overrides,
});

const page = (rows: readonly LogRow[], hasMoreRows = false) => ({
  hasMoreRows,
  rows,
});

const makeHttpHarness = (
  handleHistory: FetchHandler,
  deploymentPayload: unknown = deployment
) => {
  const requests: Request[] = [];
  let historyCall = 0;
  const fetch: typeof globalThis.fetch = async (
    input: URL | RequestInfo,
    init?: RequestInit
  ) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    const url = new URL(request.url);
    if (
      url.origin === "https://api.vercel.com" &&
      url.pathname === `/v13/deployments/${expectedHost}`
    ) {
      const payload = await deploymentPayload;
      return payload instanceof Response
        ? payload.clone()
        : Response.json(payload);
    }
    if (
      url.origin === "https://vercel.com" &&
      url.pathname === "/api/logs/request-logs"
    ) {
      return handleHistory(request, historyCall++);
    }
    return new Response("synthetic private route response", { status: 404 });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  return { layer, requests };
};

const makeRetrieval = (
  handleHistory: FetchHandler,
  requestOverrides: Partial<Partial<WorkspaceE2EMagicLinkRequest>> = {},
  deploymentPayload: unknown = deployment
) => {
  const harness = makeHttpHarness(handleHistory, deploymentPayload);
  const request = {
    callbackPath,
    deadlineAfterMs: 500,
    pollIntervalMs: 5,
    recipient,
    startedAt: new Date("2026-10-01T12:00:00.000Z"),
    ...requestOverrides,
  };
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(config);
        return yield* previewLogs.retrieveMagicLink(request);
      })
    ).pipe(Effect.provide(harness.layer))
  );
  return { ...harness, result };
};

const captureFailure = (result: Promise<string>) =>
  result.then(
    () => {
      throw new Error("expected Vercel log retrieval to fail");
    },
    (failure: unknown) => failure
  );

describe("workspace e2e Vercel log retrieval", () => {
  test("uses only the selected deployment and project history resources", async () => {
    const startedAt = new Date("2026-09-28T12:00:00.000Z");
    const { requests, result } = makeRetrieval(
      () =>
        Response.json(
          page([
            row("req-synthetic", [log(previewE2ELine(magicLink("token")))]),
          ])
        ),
      { startedAt }
    );

    await expect(result).resolves.toBe(magicLink("token"));

    expect(
      requests.map((request) => {
        const url = new URL(request.url);
        return `${request.method} ${url.origin}${url.pathname}`;
      })
    ).toEqual([
      `GET https://api.vercel.com/v13/deployments/${expectedHost}`,
      "GET https://vercel.com/api/logs/request-logs",
    ]);
    expect(
      requests.every(
        (request) =>
          request.headers.get("authorization") ===
            "Bearer vercel-log-read-token" &&
          !request.url.includes("vercel-log-read-token")
      )
    ).toBe(true);
    const query = new URL(requests[1]?.url ?? "https://vercel.com")
      .searchParams;
    expect(query.get("projectId")).toBe("workspace-preview-project");
    expect(query.get("ownerId")).toBe("team-synthetic");
    expect(query.get("deploymentId")).toBe(deployment.id);
    expect(query.get("page")).toBe("0");
    expect(query.get("search")).toBe("account.magic-link.preview-e2e");
    expect(Number(query.get("startDate"))).toBe(startedAt.getTime());
    expect(Number(query.get("endDate"))).toBeGreaterThanOrEqual(
      startedAt.getTime()
    );
    expect(
      requests.some((request) =>
        /\/v2\/user|\/teams(?:\/|$)/.test(new URL(request.url).pathname)
      )
    ).toBe(false);
  });

  test("retrieves a matching history row that appeared after the baseline", async () => {
    let historyRowAvailable = false;
    const harness = makeHttpHarness((_request, call) =>
      Response.json(
        page(
          historyRowAvailable && call > 0
            ? [
                row("req-reauth-after-baseline", [
                  log(previewE2ELine(magicLink("reauth-after-baseline"))),
                ]),
              ]
            : []
        )
      )
    );
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(config);
          const startedAt = new Date("2026-10-01T12:00:00.000Z");
          const baseline = yield* previewLogs.listSyntheticLogEntryIds({
            recipient,
            startedAt,
          });
          expect(baseline).toEqual([]);
          historyRowAvailable = true;
          return yield* previewLogs.retrieveMagicLink({
            callbackPath,
            deadlineAfterMs: 100,
            pollIntervalMs: 1,
            recipient,
            startedAt,
          });
        })
      ).pipe(Effect.provide(harness.layer))
    );

    expect(result).toBe(magicLink("reauth-after-baseline"));
  });

  test("excludes older rows by their provider timestamp", async () => {
    const oldEntry = row("req-old", [log(previewE2ELine(magicLink("old")))], {
      timestamp: "2026-10-01T11:59:59.999Z",
    });
    const freshEntry = row("req-fresh", [
      log(previewE2ELine(magicLink("fresh"))),
    ]);
    const { result } = makeRetrieval(() =>
      Response.json(page([oldEntry, freshEntry]))
    );

    await expect(result).resolves.toBe(magicLink("fresh"));
  });

  test("does not export preview URLs or Vercel identifiers in HTTP spans", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      spanProcessors: [
        new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
      ],
    });
    const body = previewE2ELine(magicLink("private-link-token"));
    const harness = makeHttpHarness(() =>
      Response.json(page([row("req-match", [log(body)])]))
    );
    const tracingLayer = createTracingLive({
      provider,
      serviceName: "deskohub-workspace-e2e-test",
    });
    const telemetryLayer = E2ETelemetryService.Default.pipe(
      Layer.provide(E2ERunContextService.layer(makeTestE2EEnvironment()))
    );
    const e2eTelemetryLayer = Layer.merge(
      Layer.merge(harness.layer, tracingLayer),
      telemetryLayer
    );
    try {
      await expect(
        Effect.runPromise(
          Effect.scoped(
            Effect.gen(function* () {
              const telemetry = yield* E2ETelemetryService;
              return yield* telemetry.traceStep({
                caseId: "account-magic-link",
                effect: Effect.gen(function* () {
                  const previewLogs =
                    yield* resolveWorkspaceE2EPreviewLogs(config);
                  return yield* previewLogs.retrieveMagicLink({
                    callbackPath,
                    recipient,
                    startedAt: new Date("2026-10-01T12:00:00.000Z"),
                  });
                }),
                stepId: "retrieves-delivered-single-use-link",
                timeoutMs: config.timeouts.authDelivery,
              });
            })
          ).pipe(Effect.provide(e2eTelemetryLayer))
        )
      ).resolves.toBe(magicLink("private-link-token"));
      await provider.forceFlush();

      const spans = exporter.getFinishedSpans();
      expect(spans.length).toBeGreaterThan(0);
      expect(
        spans.some(
          (span) =>
            span.name === "e2e.step" &&
            span.attributes["e2e.step.id"] ===
              "retrieves-delivered-single-use-link"
        )
      ).toBe(true);
      const exported = JSON.stringify(spans);
      expect(exported).not.toContain(expectedHost);
      expect(exported).not.toContain(deployment.id);
      expect(exported).not.toContain(deployment.ownerId);
      expect(exported).not.toContain(deployment.projectId);
      expect(exported).not.toContain(body);
      expect(exported).not.toContain("private-link-token");
    } finally {
      await provider.shutdown();
    }
  });

  test("fails before log retrieval when the immutable host resolves to another project", async () => {
    const { requests, result } = makeRetrieval(
      () => Response.json(page([])),
      {},
      { ...deployment, projectId: "another-project" }
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "Vercel preview deployment did not match the configured project",
      operation: "resolve Vercel preview deployment",
    });
    expect(requests).toHaveLength(1);
  });

  test("uses numeric HTTP status and discards the private response body", async () => {
    const privateBody =
      "sentinel-private-link https://private.example.test/?token=private-value";
    const { requests, result } = makeRetrieval(
      () => new Response(privateBody, { status: 403 })
    );

    const failure = await captureFailure(result);
    expect(failure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "query Vercel preview runtime logs failed (HTTP 403)",
      operation: "query Vercel preview runtime logs",
    });
    expect(requests).toHaveLength(2);
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    const failureText = [
      String(failure),
      (failure as { message?: string }).message,
      JSON.stringify(failure),
    ].join(" ");
    expect(failureText).not.toContain(privateBody);
    expect(failureText).not.toContain("private-value");
  });

  test("discards transport failure details", async () => {
    const privateDetail = "sentinel-private-transport-value";
    const { result } = makeRetrieval(() => {
      throw new Error(`private transport failure ${privateDetail}`);
    });

    const failure = await captureFailure(result);
    expect(failure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "query Vercel preview runtime logs failed (request-failed)",
      operation: "query Vercel preview runtime logs",
    });
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(privateDetail);
  });

  test("bounds a stalled historical request by the retrieval deadline", async () => {
    const { result } = makeRetrieval(
      () => new Response(new ReadableStream({ start() {} })),
      { deadlineAfterMs: 30 }
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "query Vercel preview runtime logs failed (timeout)",
      operation: "query Vercel preview runtime logs",
    });
  });

  test("bounds deployment metadata by the remaining retrieval deadline", async () => {
    const delayedMetadata = new Promise<Response>((resolve) =>
      setTimeout(() => resolve(Response.json(deployment)), 80)
    );
    const { requests, result } = makeRetrieval(
      () => Response.json(page([])),
      { deadlineAfterMs: 20 },
      delayedMetadata
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "resolve Vercel preview deployment failed (timeout)",
      operation: "resolve Vercel preview deployment",
    });
    expect(requests).toHaveLength(1);
  });

  test("clips an empty-history poll sleep to the remaining deadline", async () => {
    const { requests, result } = makeRetrieval(() => Response.json(page([])), {
      deadlineAfterMs: 30,
      pollIntervalMs: 5_000,
    });
    const startedAt = Date.now();

    const failure = await captureFailure(result);

    expect(failure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_not_observed",
      operation: "poll Vercel preview runtime logs",
    });
    expect(Date.now() - startedAt).toBeLessThan(1_000);
    expect(
      requests.filter(
        (request) => new URL(request.url).pathname === "/api/logs/request-logs"
      )
    ).toHaveLength(1);
  });

  test("reads later pages when the history response reports more rows", async () => {
    const { requests, result } = makeRetrieval((request) => {
      const pageNumber = Number(new URL(request.url).searchParams.get("page"));
      return Response.json(
        page(
          pageNumber === 0
            ? [row("req-older", [log("unrelated runtime log")])]
            : [row("req-match", [log(previewE2ELine(magicLink("token")))])],
          pageNumber === 0
        )
      );
    });

    await expect(result).resolves.toBe(magicLink("token"));
    expect(
      requests
        .filter(
          (request) =>
            new URL(request.url).pathname === "/api/logs/request-logs"
        )
        .map((request) => new URL(request.url).searchParams.get("page"))
    ).toEqual(["0", "1"]);
  });

  test("fails closed when history remains incomplete at the request-row cap", async () => {
    const rows = Array.from({ length: 100 }, (_, index) =>
      row(
        `req-${index}`,
        index === 0
          ? [log(previewE2ELine(magicLink("possibly-hidden-duplicate")))]
          : [log("unrelated runtime log")]
      )
    );
    const { requests, result } = makeRetrieval(() =>
      Response.json(page(rows, true))
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
    expect(
      requests.filter(
        (request) => new URL(request.url).pathname === "/api/logs/request-logs"
      )
    ).toHaveLength(1);
  });

  test("fails closed when a later history page is empty but still has more rows", async () => {
    const { requests, result } = makeRetrieval((request) => {
      const pageNumber = Number(new URL(request.url).searchParams.get("page"));
      return Response.json(
        page(
          pageNumber === 0
            ? [
                row("req-partial-match", [
                  log(previewE2ELine(magicLink("partial"))),
                ]),
              ]
            : [],
          true
        )
      );
    });

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
    expect(
      requests.filter(
        (request) => new URL(request.url).pathname === "/api/logs/request-logs"
      )
    ).toHaveLength(2);
  });

  test("bounds all history pages by the remaining retrieval deadline", async () => {
    const { requests, result } = makeRetrieval(
      async (request) => {
        const pageNumber = Number(
          new URL(request.url).searchParams.get("page")
        );
        await new Promise((resolve) => globalThis.setTimeout(resolve, 80));
        return Response.json(
          page(
            pageNumber === 0
              ? [row("req-older", [log("unrelated runtime log")])]
              : [row("req-match", [log(previewE2ELine(magicLink("token")))])],
            pageNumber === 0
          )
        );
      },
      { deadlineAfterMs: 120 }
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "query Vercel preview runtime logs failed (timeout)",
      operation: "query Vercel preview runtime logs",
    });
    expect(
      requests
        .filter(
          (request) =>
            new URL(request.url).pathname === "/api/logs/request-logs"
        )
        .map((request) => new URL(request.url).searchParams.get("page"))
    ).toEqual(["0", "1"]);
  });

  test("caps history traversal at one hundred request rows", async () => {
    const hundredRows = Array.from({ length: 100 }, (_, index) =>
      row(`req-${index}`, [log("unrelated runtime log")])
    );
    const { requests, result } = makeRetrieval(() =>
      Response.json(page(hundredRows, true))
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
    expect(
      requests
        .filter(
          (request) =>
            new URL(request.url).pathname === "/api/logs/request-logs"
        )
        .every(
          (request) => new URL(request.url).searchParams.get("page") === "0"
        )
    ).toBe(true);
  });

  test("matches the individual nested log, not the request-level message", async () => {
    const { result } = makeRetrieval(() =>
      Response.json(
        page([
          row("req-decoy", [log("unrelated runtime log")], {
            message: previewE2ELine(magicLink("decoy")),
          }),
        ])
      )
    );

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("accepts auth-return attempt queries in relative and same-origin callbacks", async () => {
    const callbackWithAttempt = `${callbackPath}?attempt=attempt-synthetic`;
    const absoluteCallbackWithAttempt = `https://${expectedHost}${callbackWithAttempt}`;

    for (const callback of [callbackWithAttempt, absoluteCallbackWithAttempt]) {
      const link = magicLinkWithCallback("attempt-token", callback);
      const { result } = makeRetrieval(() =>
        Response.json(page([row("req-attempt", [log(previewE2ELine(link))])]))
      );
      await expect(result).resolves.toBe(link);
    }
  });

  test("deduplicates repeated copies of the same auth link", async () => {
    const link = magicLink("deduplicated-token");
    const text = previewE2ELine(`${link}\n${link}`);
    const { result } = makeRetrieval(() =>
      Response.json(page([row("req-deduplicated", [log(text)])]))
    );

    await expect(result).resolves.toBe(link);
  });

  test("skips other recipients and returns only the requested recipient link", async () => {
    const secondRecipient = makeWorkspaceE2EAccountRecipient(config, "second");
    const { result } = makeRetrieval(() =>
      Response.json(
        page([
          row("req-second", [
            log(previewE2ELine(magicLink("second"), secondRecipient)),
          ]),
          row("req-main", [
            log(previewE2ELine(magicLink("main"), recipient.toUpperCase())),
          ]),
        ])
      )
    );

    await expect(result).resolves.toBe(magicLink("main"));
  });

  test("searches every nested log in a request row", async () => {
    const logs = Array.from({ length: 120 }, () =>
      log("unrelated runtime log")
    );
    logs.push(log(previewE2ELine(magicLink("nested-after-one-hundred"))));
    const { result } = makeRetrieval(() =>
      Response.json(page([row("req-many-logs", logs)]))
    );

    await expect(result).resolves.toBe(magicLink("nested-after-one-hundred"));
  });

  test("times out when only a different recipient is present", async () => {
    const { result } = makeRetrieval(() =>
      Response.json(
        page([
          row("req-other", [
            log(previewE2ELine(magicLink("token"), "other@resend.dev")),
          ]),
        ])
      )
    );

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("rejects multiple matching links", async () => {
    const { result } = makeRetrieval(() =>
      Response.json(
        page([
          row("req-a", [log(previewE2ELine(magicLink("first")))]),
          row("req-b", [log(previewE2ELine(magicLink("second")))]),
        ])
      )
    );

    await expect(result).rejects.toThrow("multiple preview log entries");
  });

  test("fails closed for request- or log-level truncation", async () => {
    const cases = [
      row("req-request-truncated", [log(previewE2ELine(magicLink("token")))], {
        messageTruncated: true,
      }),
      row("req-log-truncated", [log(previewE2ELine(magicLink("token")), true)]),
    ];

    for (const candidate of cases) {
      const { result } = makeRetrieval(() => Response.json(page([candidate])));
      await expect(result).rejects.toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_invalid",
        message: "Vercel log retrieval matched a truncated preview log entry",
      });
    }
  });

  test("fails closed on malformed history payloads or nested log entries", async () => {
    const malformedJson = makeRetrieval(() => new Response("not json"));
    await expect(malformedJson.result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });

    const malformedEnvelope = makeRetrieval(() => Response.json(null));
    await expect(malformedEnvelope.result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });

    const malformedEntry = makeRetrieval(() =>
      Response.json(page([row("req-invalid", [log(1)])]))
    );
    await expect(malformedEntry.result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
  });

  test("bounds metadata and history response bodies without exposing payloads", async () => {
    const privatePadding = "private-oversized-response-sentinel";
    const padding = `${privatePadding}${"x".repeat(2 * 1024 * 1024)}`;
    const metadataBody =
      `{"id":"${deployment.id}","ownerId":"${deployment.ownerId}",` +
      `"projectId":"${deployment.projectId}","padding":"${padding}"}`;
    const metadata = makeRetrieval(
      () => Response.json(page([])),
      {},
      new Response(metadataBody)
    );
    const metadataFailure = await captureFailure(metadata.result);
    expect(metadataFailure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      operation: "resolve Vercel preview deployment",
    });
    expect(JSON.stringify(metadataFailure)).not.toContain(privatePadding);

    const historyBody = `{"hasMoreRows":false,"rows":[],"padding":"${padding}"}`;
    const history = makeRetrieval(() => new Response(historyBody));
    const historyFailure = await captureFailure(history.result);
    expect(historyFailure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
    expect(JSON.stringify(historyFailure)).not.toContain(privatePadding);
  });

  test("rejects malformed matching messages and entries without the recipient", async () => {
    const malformedMessage = makeRetrieval(() =>
      Response.json(
        page([
          row("req-broken", [
            log(
              `{"code":"account.magic-link.preview-e2e","recipient":"${recipient}","text":"http`
            ),
          ]),
        ])
      )
    );
    await expect(malformedMessage.result).rejects.toThrow(
      "unreadable preview log entry"
    );

    const noRecipient = makeRetrieval(() =>
      Response.json(
        page([
          row("req-no-recipient", [
            log(previewE2ELine(magicLink("token"), null)),
          ]),
        ])
      )
    );
    await expect(noRecipient.result).rejects.toThrow(
      "unreadable preview log entry"
    );
  });

  test("returns stable baseline ids and excludes stale links across polls", async () => {
    const stale = row("req-baseline", [
      log("boot"),
      log(previewE2ELine(magicLink("stale"))),
    ]);
    const baselineHarness = makeHttpHarness(() => Response.json(page([stale])));
    const baseline = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(config);
          return yield* previewLogs.listSyntheticLogEntryIds({
            recipient,
            startedAt: new Date("2026-10-01T12:00:00.000Z"),
          });
        })
      ).pipe(Effect.provide(baselineHarness.layer))
    );
    expect(baseline).toEqual(["req-baseline:1"]);

    const fresh = row("req-fresh", [log(previewE2ELine(magicLink("fresh")))]);
    const retrievalHarness = makeHttpHarness((_request, call) =>
      Response.json(page(call === 0 ? [stale] : [stale, fresh]))
    );
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const previewLogs = yield* resolveWorkspaceE2EPreviewLogs(config);
          return yield* previewLogs.retrieveMagicLink({
            callbackPath,
            excludeLogEntryIds: baseline,
            deadlineAfterMs: 100,
            pollIntervalMs: 5,
            recipient,
            startedAt: new Date("2026-10-01T12:00:00.000Z"),
          });
        })
      ).pipe(Effect.provide(retrievalHarness.layer))
    );
    expect(result).toBe(magicLink("fresh"));
    expect(retrievalHarness.requests).toHaveLength(3);
  });

  test("rejects links outside the immutable host or expected callback", async () => {
    const foreignHost = magicLink("token").replace(
      authOrigin,
      "https://other.vercel.app"
    );
    const foreignCallback = `${authOrigin}/api/auth/magic-link/verify?token=token&callbackURL=${encodeURIComponent("https://evil.example.test/en-US/auth/callback")}`;
    const wrongPath = `${authOrigin}/not-auth/verify?token=token&callbackURL=${encodeURIComponent(callbackPath)}`;
    const missingToken = `${authOrigin}/api/auth/magic-link/verify?callbackURL=${encodeURIComponent(callbackPath)}`;
    for (const invalidLink of [
      foreignHost,
      foreignCallback,
      wrongPath,
      missingToken,
    ]) {
      const { result } = makeRetrieval(() =>
        Response.json(
          page([row("req-invalid-link", [log(previewE2ELine(invalidLink))])])
        )
      );
      await expect(result).rejects.toThrow("exactly one auth link");
    }
  });

  test("redacts the returned link and token immediately", async () => {
    const { result } = makeRetrieval(() =>
      Response.json(
        page([row("req-match", [log(previewE2ELine(magicLink("token")))])])
      )
    );

    await result;
    expect(redact(`link ${magicLink("token")} end`)).toBe(
      "link [redacted] end"
    );
  });
});
