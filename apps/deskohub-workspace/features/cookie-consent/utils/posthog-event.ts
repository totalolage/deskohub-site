import { Predicate } from "effect";
import type { BeforeSendFn } from "posthog-js";
import { sanitizePostHogProperties } from "./posthog-url";

type PostHogBeforeSendEvent = NonNullable<Parameters<BeforeSendFn>[0]>;

type PostHogException = {
  readonly mechanism?: {
    readonly handled?: unknown;
    readonly synthetic?: unknown;
  };
  readonly value?: unknown;
  readonly stacktrace?: {
    readonly frames?: unknown;
  };
};

const browserDeliveryNoiseValues = [
  "Script error.",
  "ResizeObserver loop completed with undelivered notifications.",
];

function isBrowserDeliveryNoise(event: PostHogBeforeSendEvent) {
  if (event.event !== "$exception") return false;

  const exceptionList = event.properties.$exception_list;
  if (!Array.isArray(exceptionList) || exceptionList.length !== 1) return false;

  let exception: PostHogException | undefined;
  if (Predicate.isObject(exceptionList[0])) exception = exceptionList[0];
  if (!exception) return false;
  if (
    !browserDeliveryNoiseValues.some(
      (noiseValue) => exception.value === noiseValue
    )
  ) {
    return false;
  }
  if (
    !Predicate.isObject(exception.mechanism) ||
    exception.mechanism.handled !== false ||
    exception.mechanism.synthetic !== true
  ) {
    return false;
  }

  const frames =
    Predicate.isObject(exception.stacktrace) && exception.stacktrace.frames;
  if (!Array.isArray(frames) || frames.length === 0) return true;

  // The PostHog SDK synthesizes a page URL at :0:0 for browser ErrorEvents.
  const frame = frames[0];
  return (
    exception.value ===
      "ResizeObserver loop completed with undelivered notifications." &&
    frames.length === 1 &&
    Predicate.isObject(frame) &&
    frame.lineno === 0 &&
    frame.colno === 0 &&
    frame.function === "?" &&
    Predicate.isString(frame.filename) &&
    frame.filename.length > 0
  );
}

export function preparePostHogEvent(
  event: PostHogBeforeSendEvent,
  posthogEnvironment: string
) {
  if (isBrowserDeliveryNoise(event)) return null;

  event.properties = sanitizePostHogProperties(
    event.properties,
    posthogEnvironment
  );

  return event;
}
