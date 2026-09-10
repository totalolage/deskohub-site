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

  const resizeObserverNoise = {
    mechanism: { handled: false, synthetic: true },
    type: "Error",
    value: "ResizeObserver loop completed with undelivered notifications.",
  };
  const sdkFrame = {
    filename: "https://example.test/page",
    lineno: 0,
    colno: 0,
    function: "?",
  };
  const sdkFrameWithoutLine = {
    filename: sdkFrame.filename,
    colno: 0,
    function: "?",
  };
  const realFrame = {
    ...sdkFrame,
    filename: "https://example.test/app.js",
    lineno: 1,
    colno: 1,
    function: "onResize",
  };
  const resizeObserverCase = (
    frames: unknown[],
    value = resizeObserverNoise.value
  ) => [{ ...resizeObserverNoise, value, stacktrace: { frames } }];

  test.each([
    ["drops the exact production shape", [resizeObserverNoise], true],
    [
      "drops the exact SDK placeholder frame",
      resizeObserverCase([sdkFrame]),
      true,
    ],
    [
      "keeps a frame with a positive line",
      resizeObserverCase([{ ...sdkFrame, lineno: 1 }]),
      false,
    ],
    [
      "keeps a frame with a positive column",
      resizeObserverCase([{ ...sdkFrame, colno: 1 }]),
      false,
    ],
    [
      "keeps a frame with a named function",
      resizeObserverCase([{ ...sdkFrame, function: "onResize" }]),
      false,
    ],
    [
      "keeps a frame with an absent coordinate",
      resizeObserverCase([sdkFrameWithoutLine]),
      false,
    ],
    [
      "keeps a frame with an empty filename",
      resizeObserverCase([{ ...sdkFrame, filename: "" }]),
      false,
    ],
    ["keeps a null frame", resizeObserverCase([null]), false],
    [
      "keeps two SDK placeholder frames",
      resizeObserverCase([sdkFrame, sdkFrame]),
      false,
    ],
    [
      "keeps an SDK placeholder frame with a real frame",
      resizeObserverCase([sdkFrame, realFrame]),
      false,
    ],
    [
      "keeps the same placeholder frame for Script error.",
      resizeObserverCase([sdkFrame], "Script error."),
      false,
    ],
    [
      "keeps a stackful application error",
      [
        {
          ...resizeObserverNoise,
          stacktrace: { frames: [{ filename: "app.js", in_app: true }] },
        },
      ],
      false,
    ],
    [
      "keeps a handled exception",
      [
        {
          ...resizeObserverNoise,
          mechanism: { handled: true, synthetic: true },
        },
      ],
      false,
    ],
    [
      "keeps a non-synthetic exception",
      [
        {
          ...resizeObserverNoise,
          mechanism: { handled: false, synthetic: false },
        },
      ],
      false,
    ],
    ...[
      "ResizeObserver loop completed with undelivered notifications",
      "ResizeObserver loop limit exceeded",
    ].map((value) => [
      "keeps a near-match message",
      [{ ...resizeObserverNoise, value }],
      false,
    ]),
    [
      "keeps a multi-exception event",
      [
        resizeObserverNoise,
        { type: "TypeError", value: "Cannot read properties of undefined" },
      ],
      false,
    ],
  ])("%s", (_name, exceptionList, dropped) => {
    const event = createEvent("$exception", { $exception_list: exceptionList });

    expect(preparePostHogEvent(event, "production")).toBe(
      dropped ? null : event
    );
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
