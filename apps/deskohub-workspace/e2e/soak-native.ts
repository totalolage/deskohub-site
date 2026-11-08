import { createHash } from "node:crypto";
import { Exit, Option, Tracer } from "effect";
import type { E2EEnvironment } from "./e2e-env";

export const soakEvidenceService = "deskohub-workspace-e2e";

export type NativeRunReceipt = {
  readonly service: typeof soakEvidenceService;
  readonly scope: "e2e.run";
  readonly outcome: "passed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly spanSha256: string;
};

export const evidenceDigest = (value: string) =>
  createHash("sha256").update(value).digest("hex");

/** Observes the actual Effect spans, including when remote export is disabled. */
export const makeNativeRunCapture = () => {
  const roots: Tracer.Span[] = [];
  return {
    tracer: (delegate: Tracer.Tracer) =>
      Tracer.make({
        ...delegate,
        span: (...args) => {
          const span = delegate.span(...args);
          if (span.name === "e2e.run") roots.push(span);
          return span;
        },
      }),
    receipt: (
      environment: Pick<
        E2EEnvironment,
        "GITHUB_RUN_ID" | "GITHUB_RUN_ATTEMPT" | "TARGET_SHA"
      >
    ): NativeRunReceipt => {
      const span = roots.length === 1 ? roots[0] : undefined;
      const {
        GITHUB_RUN_ID: runId,
        GITHUB_RUN_ATTEMPT: attempt,
        TARGET_SHA: sha,
      } = environment;
      if (
        !span ||
        !runId ||
        !Number.isSafeInteger(Number(runId)) ||
        !attempt ||
        !sha ||
        !Option.isNone(span.parent) ||
        span.attributes.get("e2e.scope") !== "run" ||
        span.attributes.get("e2e.run.id") !== `${runId}-${attempt}` ||
        span.attributes.get("github.run.id") !== runId ||
        span.attributes.get("github.run.attempt") !== attempt ||
        span.attributes.get("git.commit.sha") !== sha ||
        span.attributes.get("e2e.outcome") !== "passed" ||
        span.status._tag !== "Ended" ||
        !Exit.isSuccess(span.status.exit) ||
        span.status.startTime <= 0n ||
        span.status.endTime <= span.status.startTime ||
        !/^[a-f0-9]{32}$/.test(span.traceId) ||
        !/^[a-f0-9]{16}$/.test(span.spanId)
      ) {
        throw new Error("Native E2E evidence is incomplete");
      }
      return {
        service: soakEvidenceService,
        scope: "e2e.run",
        outcome: "passed",
        startedAt: nativeTimestamp(span.status.startTime),
        completedAt: nativeTimestamp(span.status.endTime),
        spanSha256: evidenceDigest(`${span.traceId}:${span.spanId}`),
      };
    },
  };
};

// Keep nanoseconds from the native clock; log-prefix times are never inputs.
export const nativeTimestamp = (nanos: bigint) =>
  `${new Date(Number(nanos / 1_000_000_000n) * 1000).toISOString().slice(0, -5)}.${(nanos % 1_000_000_000n).toString().padStart(9, "0")}Z`;
