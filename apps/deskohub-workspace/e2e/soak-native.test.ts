import { expect, spyOn, test } from "bun:test";
import { InMemorySpanExporter } from "@opentelemetry/sdk-trace-base";
import { Effect, Exit, Layer } from "effect";
import {
  createIdentifiedTracingLive,
  createWorkspaceTracerProvider,
} from "../shared/backend/observability/telemetry-sinks";
import { CENSORED_LOG_VALUE } from "../shared/utils/log-classification";
import { makeTestE2EEnvironment } from "./e2e-env.test-fixture";
import {
  E2ERunContextService,
  E2ETelemetryService,
  makeE2ERunContext,
} from "./services/telemetry";
import {
  makeNativeRunCapture,
  nativeTimestamp,
  soakEvidenceService,
} from "./soak-native";
import { makeE2ETelemetryRuntime, runE2EEffect } from "./telemetry-runtime";

const environment = makeTestE2EEnvironment({
  GITHUB_RUN_ID: "12345",
  GITHUB_RUN_ATTEMPT: "1",
  TARGET_SHA: "a".repeat(40),
});
const layer = E2ETelemetryService.Default.pipe(
  Layer.provide(E2ERunContextService.layerValue(makeE2ERunContext(environment)))
);

test("the real root span ends before the E2E closing hook, without a remote exporter", async () => {
  const runtime = makeE2ETelemetryRuntime(environment);
  let receipt: ReturnType<typeof runtime.capture.receipt> | undefined;
  const exit = await runE2EEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      yield* telemetry.traceRun(Effect.yieldNow);
    }).pipe(Effect.provide(layer)),
    {
      ...runtime,
      complete: Effect.sync(() => {
        receipt = runtime.capture.receipt(environment);
      }),
    }
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(receipt?.service).toBe("deskohub-workspace-e2e");
  expect(receipt?.outcome).toBe("passed");
  expect(receipt?.startedAt).toMatch(/\.\d{9}Z$/);
  expect(receipt!.startedAt < receipt!.completedAt).toBe(true);
  expect(() =>
    runtime.capture.receipt({ ...environment, GITHUB_RUN_ATTEMPT: 2 })
  ).toThrow();
  expect(() =>
    runtime.capture.receipt({ ...environment, TARGET_SHA: "b".repeat(40) })
  ).toThrow();
  expect(() =>
    runtime.capture.receipt({ ...environment, GITHUB_RUN_ID: "23456" })
  ).toThrow();
});

for (const [name, effect] of [
  ["failed", Effect.fail("synthetic failure")],
  ["interrupted", Effect.interrupt],
] as const) {
  test(`a ${name} actual root never produces passed native evidence`, async () => {
    const runtime = makeE2ETelemetryRuntime(environment);
    const exit = await runE2EEffect(
      Effect.gen(function* () {
        const telemetry = yield* E2ETelemetryService;
        return yield* telemetry.traceRun(effect);
      }).pipe(Effect.provide(layer)),
      runtime
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(() => runtime.capture.receipt(environment)).toThrow();
  });
}

test("missing and duplicate actual native roots fail closed", async () => {
  const runtime = makeE2ETelemetryRuntime(environment);
  expect(() => makeNativeRunCapture().receipt(environment)).toThrow();
  await runE2EEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      yield* telemetry.traceRun(Effect.yieldNow);
      yield* telemetry.traceRun(Effect.yieldNow);
    }).pipe(Effect.provide(layer)),
    runtime
  );
  expect(() => runtime.capture.receipt(environment)).toThrow();
});

test("an actual started but incomplete root cannot be read as evidence", async () => {
  const runtime = makeE2ETelemetryRuntime(environment);
  await runE2EEffect(
    Effect.gen(function* () {
      const telemetry = yield* E2ETelemetryService;
      yield* telemetry.traceRun(
        Effect.sync(() => {
          expect(() => runtime.capture.receipt(environment)).toThrow();
        })
      );
    }).pipe(Effect.provide(layer)),
    runtime
  );
  expect(runtime.capture.receipt(environment).outcome).toBe("passed");
});

test("capture rejection preserves a real failed root and emits only the safe no-proof marker", async () => {
  const runtime = makeE2ETelemetryRuntime({
    ...environment,
    GITHUB_ACTIONS: "true",
  });
  const warning = spyOn(console, "warn").mockImplementation(() => {});
  try {
    const exit = await runE2EEffect(
      Effect.gen(function* () {
        const telemetry = yield* E2ETelemetryService;
        return yield* telemetry.traceRun(Effect.fail("synthetic failure"));
      }).pipe(Effect.provide(layer)),
      runtime
    );
    expect(Exit.isFailure(exit)).toBe(true);
    expect(warning.mock.calls).toEqual([
      ["C18_SOAK_EVIDENCE_UNAVAILABLE incomplete-proof"],
    ]);
  } finally {
    warning.mockRestore();
  }
});

test("the configured OTel tracer's actual native timestamps equal the receipt", async () => {
  const exporter = new InMemorySpanExporter();
  const identity = {
    deploymentEnvironment: "preview",
    serviceName: soakEvidenceService,
    serviceVersion: environment.TARGET_SHA,
  };
  const provider = createWorkspaceTracerProvider(exporter, identity);
  const runtime = makeE2ETelemetryRuntime(environment);
  try {
    await runE2EEffect(
      Effect.gen(function* () {
        const telemetry = yield* E2ETelemetryService;
        yield* telemetry.traceRun(Effect.yieldNow);
      }).pipe(Effect.provide(layer)),
      {
        ...runtime,
        tracingLayer: createIdentifiedTracingLive(identity, provider),
      }
    );
    await provider.forceFlush();
    const roots = exporter
      .getFinishedSpans()
      .filter(({ name }) => name === "e2e.run");
    expect(roots).toHaveLength(1);
    const root = roots[0]!;
    const receipt = runtime.capture.receipt(environment);
    expect(receipt.startedAt).toBe(
      nativeTimestamp(
        BigInt(root.startTime[0]) * 1_000_000_000n + BigInt(root.startTime[1])
      )
    );
    expect(receipt.completedAt).toBe(
      nativeTimestamp(
        BigInt(root.endTime[0]) * 1_000_000_000n + BigInt(root.endTime[1])
      )
    );
    expect(root.attributes["e2e.outcome"]).toBe("passed");
    expect(root.resource.attributes).toMatchObject({
      "deployment.environment.name": CENSORED_LOG_VALUE,
      "service.name": soakEvidenceService,
      "service.namespace": "deskohub",
      "service.version": environment.TARGET_SHA,
    });
  } finally {
    await provider.shutdown();
  }
});
