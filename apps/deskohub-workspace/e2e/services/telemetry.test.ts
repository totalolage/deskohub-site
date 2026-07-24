import { describe, expect, test } from "bun:test";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { Cause, Effect, Exit, Layer } from "effect";
import {
  CENSORED_LOG_VALUE,
  createCensoredOtelSpanExporter,
} from "../../shared/backend/logging/censorship";
import { createTracingLive } from "../../shared/backend/observability/otel-tracing";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { workspaceE2ETimeoutError } from "../errors";
import {
  E2ERunContextService,
  E2ETelemetryService,
  makeE2ERunContext,
  toE2EResult,
  toE2ESpanAttributes,
} from "./telemetry";

describe("E2E run context", () => {
  test("defaults local execution to manual", () => {
    expect(
      makeE2ERunContext(makeTestE2EEnvironment(), () => "local-run")
    ).toEqual({
      executionContext: "manual",
      runId: "manual-local-run",
    });
  });

  test("uses explicit CI context and GitHub correlation values", () => {
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_RUN_ATTEMPT: "2",
          GITHUB_RUN_ID: "12345",
          TARGET_SHA: "a".repeat(40),
          WORKSPACE_E2E_EXECUTION_CONTEXT: "ci",
          WORKSPACE_E2E_PR_NUMBER: "124",
        })
      )
    ).toEqual({
      executionContext: "ci",
      githubRunAttempt: 2,
      githubRunId: "12345",
      prNumber: 124,
      runId: "12345-2",
      targetSha: "a".repeat(40),
    });
  });

  test("derives the first-rollout fallback from the GitHub trigger", () => {
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "repository_dispatch",
        }),
        () => "ci-run"
      ).executionContext
    ).toBe("ci");
    expect(
      makeE2ERunContext(
        makeTestE2EEnvironment({
          GITHUB_ACTIONS: "true",
          GITHUB_EVENT_NAME: "workflow_dispatch",
        }),
        () => "manual-run"
      ).executionContext
    ).toBe("manual");
  });
});

test("builds bounded searchable span attributes", () => {
  expect(
    toE2ESpanAttributes(
      {
        executionContext: "ci",
        githubRunAttempt: 3,
        githubRunId: "987",
        prNumber: 120,
        runId: "987-3",
        targetSha: "b".repeat(40),
      },
      {
        caseId: "checkout-cowork-basic",
        scope: "step",
        stepId: "complete-hosted-payment",
        timeoutMs: 45_000,
      }
    )
  ).toEqual({
    "e2e.case.id": "checkout-cowork-basic",
    "e2e.execution_context": "ci",
    "e2e.run.id": "987-3",
    "e2e.scope": "step",
    "e2e.step.id": "complete-hosted-payment",
    "e2e.timeout_ms": 45_000,
    "git.commit.sha": "b".repeat(40),
    "github.pull_request.number": 120,
    "github.run.attempt": 3,
    "github.run.id": "987",
  });
});

test("maps success, errors, defects, timeouts, and interruption to closed results", () => {
  expect(toE2EResult(Exit.succeed(undefined))).toEqual({
    outcome: "passed",
  });
  expect(toE2EResult(Exit.fail("failed"))).toEqual({
    failureKind: "error",
    outcome: "failed",
  });
  expect(toE2EResult(Exit.die("defect"))).toEqual({
    failureKind: "defect",
    outcome: "failed",
  });
  expect(toE2EResult(Exit.fail(workspaceE2ETimeoutError("timed out")))).toEqual(
    {
      failureKind: "timeout",
      outcome: "timed_out",
    }
  );
  expect(toE2EResult(Exit.failCause(Cause.interrupt(1)))).toEqual({
    outcome: "cancelled",
  });
});

test("exports one run trace with nested case and step spans", async () => {
  const { exporter, layer, provider } = makeTestTelemetry();

  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const telemetry = yield* E2ETelemetryService;
        yield* telemetry.traceRun(
          telemetry.traceCase({
            caseId: "checkout-cowork-basic",
            effect: telemetry.traceStep({
              caseId: "checkout-cowork-basic",
              effect: Effect.sleep("5 millis"),
              stepId: "complete-hosted-payment",
              timeoutMs: 45_000,
            }),
            timeoutMs: 120_000,
          })
        );
      }).pipe(Effect.provide(layer))
    );

    const spans = exporter.getFinishedSpans();
    const runSpan = findSpan(spans, "e2e.run");
    const caseSpan = findSpan(spans, "e2e.case");
    const stepSpan = findSpan(spans, "e2e.step");

    expect(spans).toHaveLength(3);
    expect(caseSpan.spanContext().traceId).toBe(runSpan.spanContext().traceId);
    expect(stepSpan.spanContext().traceId).toBe(runSpan.spanContext().traceId);
    expect(caseSpan.parentSpanContext?.spanId).toBe(
      runSpan.spanContext().spanId
    );
    expect(stepSpan.parentSpanContext?.spanId).toBe(
      caseSpan.spanContext().spanId
    );
    expect(stepSpan.attributes).toMatchObject({
      "e2e.case.id": "checkout-cowork-basic",
      "e2e.execution_context": "ci",
      "e2e.outcome": "passed",
      "e2e.run.id": "987-3",
      "e2e.scope": "step",
      "e2e.step.id": "complete-hosted-payment",
      "e2e.timeout_ms": 45_000,
      "github.run.attempt": 3,
      "github.run.id": "987",
    });
    expect(spanDurationMs(stepSpan)).toBeGreaterThan(0);
    expect(spanDurationMs(caseSpan)).toBeGreaterThanOrEqual(
      spanDurationMs(stepSpan)
    );
    expect(spanDurationMs(runSpan)).toBeGreaterThanOrEqual(
      spanDurationMs(caseSpan)
    );
  } finally {
    await provider.shutdown();
  }
});

test("exports only closed failure facts and preserves the original failure", async () => {
  const unsafeFailure = new Error(
    "provider payload and customer data must not reach PostHog"
  );
  const { exporter, layer, provider } = makeTestTelemetry();

  try {
    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const telemetry = yield* E2ETelemetryService;
        yield* telemetry.traceRun(Effect.fail(unsafeFailure));
      }).pipe(Effect.provide(layer))
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.squash(exit.cause)).toBe(unsafeFailure);
    }

    const span = findSpan(exporter.getFinishedSpans(), "e2e.run");
    expect(span.attributes).toMatchObject({
      "e2e.failure.kind": "error",
      "e2e.outcome": "failed",
    });
    expect(span.events[0]?.name).toBe("exception");
    const serialized = JSON.stringify({
      attributes: span.attributes,
      events: span.events,
      status: span.status,
    });
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(unsafeFailure.message);
  } finally {
    await provider.shutdown();
  }
});

const makeTestTelemetry = () => {
  const exporter = new InMemorySpanExporter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
    ],
  });
  const environment = makeTestE2EEnvironment({
    GITHUB_ACTIONS: "true",
    GITHUB_RUN_ATTEMPT: "3",
    GITHUB_RUN_ID: "987",
    TARGET_SHA: "b".repeat(40),
    WORKSPACE_E2E_EXECUTION_CONTEXT: "ci",
  });
  const telemetryLayer = E2ETelemetryService.Live.pipe(
    Layer.provide(E2ERunContextService.layer(environment))
  );
  const tracingLayer = createTracingLive({
    provider,
    serviceName: "deskohub-workspace-e2e-test",
  });

  return {
    exporter,
    layer: Layer.merge(telemetryLayer, tracingLayer),
    provider,
  };
};

const findSpan = (spans: ReadonlyArray<ReadableSpan>, name: string) => {
  const span = spans.find((candidate) => candidate.name === name);
  if (!span) throw new Error(`Expected ${name} span`);
  return span;
};

const spanDurationMs = (span: ReadableSpan) =>
  span.duration[0] * 1_000 + span.duration[1] / 1_000_000;
