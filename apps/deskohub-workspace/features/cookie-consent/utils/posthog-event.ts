import { Predicate } from "effect";
import type { BeforeSendFn } from "posthog-js";
import {
  sanitizePostHogProperties,
  sanitizePostHogUrlProperties,
} from "./posthog-url";

type PostHogBeforeSendEvent = NonNullable<Parameters<BeforeSendFn>[0]>;

export function preparePostHogEvent(
  event: PostHogBeforeSendEvent,
  posthogEnvironment: string
) {
  event.properties = sanitizePostHogProperties(
    event.properties,
    posthogEnvironment
  );

  if (Predicate.isObject(event.$set)) {
    event.$set = sanitizePostHogUrlProperties(event.$set);
  }
  if (Predicate.isObject(event.$set_once)) {
    event.$set_once = sanitizePostHogUrlProperties(event.$set_once);
  }

  return event;
}
