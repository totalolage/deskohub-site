import { describe, expect, test } from "bun:test";
import { preparePostHogEvent } from "./posthog-event";

const createEvent = (
  event: string,
  properties: Parameters<typeof preparePostHogEvent>[0]["properties"]
) => ({
  uuid: "019ee060-bc9f-7070-aea9-9440835fe38f",
  event,
  properties,
});

describe("preparePostHogEvent", () => {
  test("drops opaque cross-origin script errors without a stack", () => {
    expect(
      preparePostHogEvent(
        createEvent("$exception", {
          $exception_list: [
            {
              mechanism: {
                handled: false,
                synthetic: true,
              },
              type: "Error",
              value: "Script error.",
            },
          ],
        }),
        "production"
      )
    ).toBeNull();
  });

  test("keeps an application error with the same message and a stack", () => {
    const event = createEvent("$exception", {
      $exception_list: [
        {
          type: "Error",
          value: "Script error.",
          stacktrace: {
            frames: [
              {
                filename: "https://workspace.deskohub.cz/_next/app.js",
                in_app: true,
              },
            ],
          },
        },
      ],
    });

    expect(preparePostHogEvent(event, "production")).toBe(event);
  });

  test("keeps a handled string exception with the same message", () => {
    const event = createEvent("$exception", {
      $exception_list: [
        {
          mechanism: {
            handled: true,
            synthetic: true,
          },
          type: "Error",
          value: "Script error.",
        },
      ],
    });

    expect(preparePostHogEvent(event, "production")).toBe(event);
  });

  test("keeps actionable exceptions and sanitizes their urls", () => {
    const event = createEvent("$exception", {
      $current_url:
        "https://workspace.deskohub.cz/en/checkout?checkoutToken=secret&step=pay",
      $exception_list: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined",
        },
      ],
    });

    expect(preparePostHogEvent(event, "production")?.properties).toEqual({
      $current_url: "https://workspace.deskohub.cz/en/checkout?step=pay",
      $exception_list: [
        {
          type: "TypeError",
          value: "Cannot read properties of undefined",
        },
      ],
      "deployment.environment.name": "production",
    });
  });

  test("keeps ordinary analytics events", () => {
    const event = createEvent("workspace page viewed", {});

    expect(preparePostHogEvent(event, "production")).toBe(event);
  });
});
