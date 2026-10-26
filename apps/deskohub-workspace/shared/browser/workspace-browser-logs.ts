import { Effect, Predicate, References } from "effect";
import {
  censorErrorClassificationValue,
  classifyErrorType,
} from "@/shared/utils/log-classification";
import { createOutbox } from "@/shared/utils/outbox";

type WorkspaceBrowserLogAttributes = Record<string, string | number | boolean>;

/**
 * A browser failure reduced to classification attributes: the run's
 * operation and boundary, the failure code, the error type from a fixed
 * allowlist, and an HTTP status. Error messages, stacks, payloads, and every
 * other value are never part of a record.
 */
export interface WorkspaceBrowserLogRecord {
  readonly attributes: Readonly<WorkspaceBrowserLogAttributes>;
  readonly body: string;
  readonly level: "warn";
}

type WorkspaceBrowserLogSink = (record: WorkspaceBrowserLogRecord) => void;

const outbox = createOutbox<WorkspaceBrowserLogRecord>({ capacity: 50 });

/**
 * Attaches the sink that receives browser logs, first the records logged
 * while no sink was attached, then each later record once. Returns the detach
 * function. A sink that throws loses that record and nothing else.
 */
export const deliverWorkspaceBrowserLogs = (
  sink: WorkspaceBrowserLogSink
): (() => void) => outbox.attach(sink);

/** Drops records still waiting for a sink, such as after consent withdrawal. */
export const discardWorkspaceBrowserLogs = (): void => outbox.discard();

/**
 * Records one censored failure for PostHog Logs, annotated with the
 * `operation` and `boundary` of the `runWorkspaceBrowserEffect` run. Use a
 * stable, low-cardinality `failureCode` without IDs, URLs, or payload data.
 * Never fails: a failing projection or sink loses the record.
 */
export const reportWorkspaceBrowserFailure = (
  failureCode: string,
  cause: unknown
): Effect.Effect<void> =>
  Effect.withFiber((fiber) =>
    Effect.sync(() =>
      outbox.post(
        toFailureRecord(
          failureCode,
          cause,
          fiber.getRef(References.CurrentLogAnnotations)
        )
      )
    )
  ).pipe(Effect.ignoreCause);

const toFailureRecord = <Annotations>(
  failureCode: string,
  cause: unknown,
  annotations: Annotations
): WorkspaceBrowserLogRecord => {
  const attributes: WorkspaceBrowserLogAttributes = {};
  addClassification(attributes, annotations, annotationKeys);
  addClassification(attributes, { failureCode }, ["failureCode"]);
  attributes.errorType = classifyErrorType(cause);
  if (Predicate.hasProperty(cause, "status") && isHttpStatus(cause.status)) {
    attributes.status = cause.status;
  }

  return { attributes, body: "Workspace browser failure", level: "warn" };
};

// Set by `runWorkspaceBrowserEffect` from code literals.
const annotationKeys = ["boundary", "operation"] as const;

const addClassification = <T>(
  attributes: WorkspaceBrowserLogAttributes,
  source: T,
  keys: readonly string[]
) => {
  if (!Predicate.isObject(source)) return;

  for (const key of keys) {
    if (!Predicate.hasProperty(source, key)) continue;
    const value = censorErrorClassificationValue(source[key]);
    if (
      Predicate.isString(value) ||
      Predicate.isNumber(value) ||
      Predicate.isBoolean(value)
    ) {
      attributes[key] = value;
    }
  }
};

const isHttpStatus = <T>(value: T): value is T & number =>
  Number.isInteger(value) &&
  Predicate.isNumber(value) &&
  value >= 100 &&
  value <= 599;
