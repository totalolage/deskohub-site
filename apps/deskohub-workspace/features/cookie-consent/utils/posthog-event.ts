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

  const exception = exceptionList[0] as PostHogException | undefined;
  if (
    !browserDeliveryNoiseValues.some(
      (noiseValue) => exception?.value === noiseValue
    )
  ) {
    return false;
  }
  if (
    exception?.mechanism?.handled !== false ||
    exception?.mechanism?.synthetic !== true
  ) {
    return false;
  }

  const frames = exception?.stacktrace?.frames;
  return !Array.isArray(frames) || frames.length === 0;
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
