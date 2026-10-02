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
  openWorkspaceE2EPreviewLogStream,
  type WorkspaceE2EPreviewLogStream,
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
const startedAt = new Date("2026-10-01T12:00:00.000Z");
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

const runtimeLogLine = (
  rowId: string,
  message: string,
  timestampInMs = startedAt.getTime() + 1,
  messageTruncated?: boolean
) =>
  `${JSON.stringify({
    message,
    ...(messageTruncated === undefined ? {} : { messageTruncated }),
    rowId,
    timestampInMs,
  })}\n`;

type FetchHandler = (
  request: Request,
  streamCall: number
) => Response | Promise<Response>;

const makeStreamResponse = (
  text: string,
  options: {
    readonly close?: boolean;
    readonly chunks?: readonly string[];
  } = {}
) =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of options.chunks ?? [text]) {
          controller.enqueue(encoder.encode(chunk));
        }
        if (options.close !== false) controller.close();
      },
    }),
    { status: 200 }
  );

const makeHttpHarness = (
  handleStream: FetchHandler,
  deploymentPayload: unknown = deployment
) => {
  const requests: Request[] = [];
  const requestSignals: AbortSignal[] = [];
  let streamCall = 0;
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    requests.push(request.clone());
    requestSignals.push(request.signal);
    const url = new URL(request.url);
    if (
      url.origin === "https://api.vercel.com" &&
      url.pathname === `/v13/deployments/${expectedHost}`
    ) {
      return Response.json(deploymentPayload);
    }
    if (
      url.origin === "https://api.vercel.com" &&
      url.pathname ===
        `/v1/projects/${deployment.projectId}/deployments/${deployment.id}/runtime-logs`
    ) {
      return handleStream(request, streamCall++);
    }
    return new Response("synthetic private route response", { status: 404 });
  };
  const layer = FetchHttpClient.layer.pipe(
    Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
  );
  return { layer, requestSignals, requests };
};

const makeRetrieval = (
  handleStream: FetchHandler,
  requestOverrides: Partial<
    Parameters<WorkspaceE2EPreviewLogStream["retrieveMagicLink"]>[0]
  > = {},
  deploymentPayload: unknown = deployment
) => {
  const harness = makeHttpHarness(handleStream, deploymentPayload);
  const request = {
    callbackPath,
    deadlineAfterMs: 500,
    pollIntervalMs: 5,
    recipient,
    startedAt,
    ...requestOverrides,
  };
  const result = Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const logStream = yield* openWorkspaceE2EPreviewLogStream(config);
        return yield* logStream.retrieveMagicLink(request);
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
  test("opens the project stream before sign-in and consumes split JSONL chunks", async () => {
    const requests: Request[] = [];
    let streamOpenedBeforeSignIn = false;
    let signInRequested = false;
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const fetch: typeof globalThis.fetch = async (input, init) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request.clone());
      const url = new URL(request.url);
      if (url.pathname === `/v13/deployments/${expectedHost}`) {
        return Response.json(deployment);
      }
      if (
        url.pathname ===
        `/v1/projects/${deployment.projectId}/deployments/${deployment.id}/runtime-logs`
      ) {
        streamOpenedBeforeSignIn = !signInRequested;
        return new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
            },
          }),
          { status: 200 }
        );
      }
      return new Response("private route body", { status: 404 });
    };
    const layer = FetchHttpClient.layer.pipe(
      Layer.provide(Layer.succeed(FetchHttpClient.Fetch, fetch))
    );

    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const logStream = yield* openWorkspaceE2EPreviewLogStream(config);
          signInRequested = true;
          const frame = new TextEncoder().encode(
            runtimeLogLine("row-synthetic", previewE2ELine(magicLink("token")))
          );
          controller?.enqueue(frame.slice(0, 19));
          controller?.enqueue(frame.slice(19));
          controller?.close();
          return yield* logStream.retrieveMagicLink({
            callbackPath,
            deadlineAfterMs: 100,
            pollIntervalMs: 1,
            recipient,
            startedAt,
          });
        })
      ).pipe(Effect.provide(layer))
    );

    await expect(result).resolves.toBe(magicLink("token"));
    expect(streamOpenedBeforeSignIn).toBe(true);
    expect(
      requests.map((request) => {
        const url = new URL(request.url);
        return `${request.method} ${url.origin}${url.pathname}`;
      })
    ).toEqual([
      `GET https://api.vercel.com/v13/deployments/${expectedHost}`,
      `GET https://api.vercel.com/v1/projects/${deployment.projectId}/deployments/${deployment.id}/runtime-logs`,
    ]);
    const streamRequest = requests[1]!;
    expect(new URL(streamRequest.url).searchParams.get("format")).toBe("lines");
    expect(
      requests.every(
        (request) =>
          request.headers.get("authorization") ===
            "Bearer vercel-log-read-token" &&
          !request.url.includes("vercel-log-read-token")
      )
    ).toBe(true);
    expect(
      requests.some((request) =>
        /\/v2\/user|\/teams(?:\/|$)/.test(new URL(request.url).pathname)
      )
    ).toBe(false);
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
      makeStreamResponse(runtimeLogLine("row-match", body))
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
          Effect.gen(function* () {
            const telemetry = yield* E2ETelemetryService;
            return yield* telemetry.traceStep({
              caseId: "account-magic-link",
              effect: Effect.scoped(
                Effect.gen(function* () {
                  const logStream =
                    yield* openWorkspaceE2EPreviewLogStream(config);
                  return yield* logStream.retrieveMagicLink({
                    callbackPath,
                    recipient,
                    startedAt,
                    pollIntervalMs: 1,
                  });
                })
              ),
              stepId: "retrieves-delivered-single-use-link",
              timeoutMs: config.timeouts.authDelivery,
            });
          }).pipe(Effect.provide(e2eTelemetryLayer))
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

  test("fails before opening the stream when deployment metadata names another project", async () => {
    const { requests, result } = makeRetrieval(
      () => makeStreamResponse(""),
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
      message: "open Vercel preview runtime log stream failed (HTTP 403)",
      operation: "open Vercel preview runtime log stream",
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
      message: "open Vercel preview runtime log stream failed (request-failed)",
      operation: "open Vercel preview runtime log stream",
    });
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    expect(JSON.stringify(failure)).not.toContain(privateDetail);
  });

  test("bounds a stalled stream by the delivery deadline", async () => {
    const { result } = makeRetrieval(
      () => new Response(new ReadableStream({ start() {} })),
      { deadlineAfterMs: 30 }
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_not_observed",
      message:
        "Vercel log retrieval did not observe the preview magic-link entry before the deadline",
      operation: "poll Vercel preview runtime logs",
    });
  });

  test("returns only a matching recipient from streamed rows", async () => {
    const secondRecipient = makeWorkspaceE2EAccountRecipient(config, "second");
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine("row-unrelated", "unrelated runtime log") +
          runtimeLogLine(
            "row-second",
            previewE2ELine(magicLink("second"), secondRecipient)
          ) +
          runtimeLogLine(
            "row-main",
            previewE2ELine(magicLink("main"), recipient.toUpperCase())
          )
      )
    );

    await expect(result).resolves.toBe(magicLink("main"));
  });

  test("accepts auth-return attempt queries in relative and same-origin callback URLs", async () => {
    const relativeCallback = `${callbackPath}?attempt=synthetic-attempt`;
    const callbackUrls = [relativeCallback, `${authOrigin}${relativeCallback}`];

    for (const callback of callbackUrls) {
      const link = magicLinkWithCallback("attempt-token", callback);
      const { result } = makeRetrieval(() =>
        makeStreamResponse(runtimeLogLine("row-attempt", previewE2ELine(link)))
      );

      await expect(result).resolves.toBe(link);
    }
  });

  test("deduplicates repeated copies of the same auth link", async () => {
    const link = magicLink("repeated");
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine("row-repeated", previewE2ELine(`${link} ${link}`))
      )
    );

    await expect(result).resolves.toBe(link);
  });

  test("fails closed when the stream ends before a requested recipient appears", async () => {
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine(
          "row-other-ended",
          previewE2ELine(magicLink("token"), "other@resend.dev")
        )
      )
    );

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_not_observed",
      message:
        "Vercel preview runtime log stream ended before the magic-link entry was observed",
    });
  });

  test("fails closed when an invalid frame follows a matching row", async () => {
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine("row-match", previewE2ELine(magicLink("token"))) +
          "not json\n"
      )
    );

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
  });

  test("waits until the deadline when only a different recipient is present", async () => {
    const { result } = makeRetrieval(
      () =>
        makeStreamResponse(
          runtimeLogLine(
            "row-other",
            previewE2ELine(magicLink("token"), "other@resend.dev")
          ),
          { close: false }
        ),
      { deadlineAfterMs: 30, pollIntervalMs: 5 }
    );

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_not_observed",
    });
  });

  test("bounds retained synthetic rows and fails closed at the limit", async () => {
    const otherRecipient = "other@resend.dev";
    const rows = Array.from({ length: 101 }, (_, index) =>
      runtimeLogLine(
        `row-${index}`,
        previewE2ELine(magicLink(`token-${index}`), otherRecipient)
      )
    ).join("");
    const { result } = makeRetrieval(() => makeStreamResponse(rows));

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
  });

  test("fails closed when overflow could hide a duplicate matching row", async () => {
    const otherRecipient = "other@resend.dev";
    const rows = [
      runtimeLogLine("row-match-first", previewE2ELine(magicLink("first"))),
      ...Array.from({ length: 99 }, (_, index) =>
        runtimeLogLine(
          `row-${index}`,
          previewE2ELine(magicLink(`token-${index}`), otherRecipient)
        )
      ),
      runtimeLogLine("row-match-hidden", previewE2ELine(magicLink("second"))),
    ].join("");
    const { result } = makeRetrieval(() => makeStreamResponse(rows));

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
  });

  test("rejects multiple matching rows already present in the stream", async () => {
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine("row-a", previewE2ELine(magicLink("first"))) +
          runtimeLogLine("row-b", previewE2ELine(magicLink("second")))
      )
    );

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_ambiguous",
      message:
        "Vercel log retrieval matched multiple preview log entries within the query window",
    });
  });

  test("fails closed when a matching stream row is truncated", async () => {
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine(
          "row-truncated",
          previewE2ELine(magicLink("token")),
          startedAt.getTime() + 1,
          true
        )
      )
    );

    await expect(result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel log retrieval matched a truncated preview log entry",
    });
  });

  test("fails closed on malformed streamed JSON or candidate fields", async () => {
    const malformedJson = makeRetrieval(() => makeStreamResponse("not json\n"));
    await expect(malformedJson.result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });

    const malformedCandidate = makeRetrieval(() =>
      makeStreamResponse(
        `${JSON.stringify({
          message: previewE2ELine(magicLink("token")),
          timestampInMs: startedAt.getTime() + 1,
        })}\n`
      )
    );
    await expect(malformedCandidate.result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
  });

  test("rejects malformed matching messages and entries without a recipient", async () => {
    const malformedMessage = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine(
          "row-broken",
          `{"code":"account.magic-link.preview-e2e","recipient":"${recipient}","text":"http`
        )
      )
    );
    await expect(malformedMessage.result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel log retrieval matched an unreadable preview log entry",
    });

    const noRecipient = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine(
          "row-no-recipient",
          previewE2ELine(magicLink("token"), null)
        )
      )
    );
    await expect(noRecipient.result).rejects.toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel log retrieval matched an unreadable preview log entry",
    });
  });

  test("uses row IDs and timestamps to exclude stale links across sends", async () => {
    let controller: ReadableStreamDefaultController<Uint8Array> | undefined;
    const harness = makeHttpHarness(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(value) {
              controller = value;
              value.enqueue(
                new TextEncoder().encode(
                  runtimeLogLine(
                    "row-stale",
                    previewE2ELine(magicLink("stale")),
                    startedAt.getTime() - 1
                  ) +
                    runtimeLogLine(
                      "row-baseline",
                      previewE2ELine(magicLink("baseline")),
                      startedAt.getTime() + 1
                    )
                )
              );
            },
          }),
          { status: 200 }
        )
    );
    const result = Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const logStream = yield* openWorkspaceE2EPreviewLogStream(config);
          yield* Effect.sleep("5 millis");
          const baseline = yield* logStream.listSyntheticLogEntryIds({
            recipient,
            startedAt,
          });
          expect(baseline).toEqual(["row-baseline"]);
          controller?.enqueue(
            new TextEncoder().encode(
              runtimeLogLine(
                "row-fresh",
                previewE2ELine(magicLink("fresh")),
                startedAt.getTime() + 2
              )
            )
          );
          return yield* logStream.retrieveMagicLink({
            callbackPath,
            deadlineAfterMs: 100,
            excludeLogEntryIds: baseline,
            pollIntervalMs: 1,
            recipient,
            startedAt,
          });
        })
      ).pipe(Effect.provide(harness.layer))
    );

    const outcome = await result.then(
      (value) => ({ value }),
      (failure: unknown) => ({ failure })
    );
    expect(outcome).toEqual({ value: magicLink("fresh") });
  });

  test("fails closed on an oversized unfinished line without exposing it", async () => {
    const privateFrame = `private-${"x".repeat(64 * 1024)}`;
    const { result } = makeRetrieval(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(new TextEncoder().encode(privateFrame));
            },
          }),
          { status: 200 }
        ),
      { deadlineAfterMs: 100, pollIntervalMs: 1 }
    );

    const failure = await captureFailure(result);
    expect(failure).toMatchObject({
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
    });
    expect(JSON.stringify(failure)).not.toContain(privateFrame);
  });

  test("aborts the streaming request when the account scope closes", async () => {
    const harness = makeHttpHarness(
      () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
        })
    );
    await Effect.runPromise(
      Effect.scoped(
        openWorkspaceE2EPreviewLogStream(config).pipe(Effect.asVoid)
      ).pipe(Effect.provide(harness.layer))
    );

    expect(harness.requestSignals[1]?.aborted).toBe(true);
  });

  test("rejects links outside the immutable host or expected callback", async () => {
    const foreignHost = magicLink("token").replace(
      authOrigin,
      "https://other.vercel.app"
    );
    const foreignCallback = `${authOrigin}/api/auth/magic-link/verify?token=token&callbackURL=${encodeURIComponent("https://evil.example.test/en-US/auth/callback")}`;
    const wrongCallbackPath = magicLinkWithCallback(
      "token",
      `${authOrigin}/wrong/auth/callback`
    );
    for (const invalidLink of [
      foreignHost,
      foreignCallback,
      wrongCallbackPath,
    ]) {
      const { result } = makeRetrieval(() =>
        makeStreamResponse(
          runtimeLogLine("row-invalid-link", previewE2ELine(invalidLink))
        )
      );
      await expect(result).rejects.toMatchObject({
        diagnosticCode: "auth_delivery_message_invalid",
        message:
          "Vercel log retrieval did not contain exactly one auth link for the immutable preview callback",
      });
    }
  });

  test("redacts the returned link and token immediately", async () => {
    const { result } = makeRetrieval(() =>
      makeStreamResponse(
        runtimeLogLine("row-match", previewE2ELine(magicLink("token")))
      )
    );

    await result;
    expect(redact(`link ${magicLink("token")} end`)).toBe(
      "link [redacted] end"
    );
  });
});
