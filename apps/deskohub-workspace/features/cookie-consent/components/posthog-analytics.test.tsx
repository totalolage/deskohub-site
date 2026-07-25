import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import type { BeforeSendFn } from "posthog-js";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";

const featureFlagListeners = new Set<() => void>();
let featureFlagOverrides: Readonly<Record<string, boolean | string>> = {};

let beforeSend: BeforeSendFn | undefined;
const sentEvents: unknown[] = [];
const init = mock(
  (_projectToken: string, options: { readonly before_send?: BeforeSendFn }) => {
    beforeSend = options.before_send;
  }
);
const capture = mock(
  (event: string, properties?: Readonly<Record<string, unknown>>) => {
    const posthogEvent = {
      event,
      properties: { ...(properties ?? {}) },
    } as NonNullable<Parameters<BeforeSendFn>[0]>;
    const sanitized = beforeSend?.(posthogEvent);
    if (sanitized) sentEvents.push(sanitized);
  }
);
const overrideFeatureFlags = mock(
  (
    overrides:
      | false
      | {
          readonly flags: Readonly<Record<string, boolean | string>>;
        }
  ) => {
    featureFlagOverrides = overrides === false ? {} : overrides.flags;
    for (const listener of featureFlagListeners) listener();
  }
);
const optInCapturing = mock(() => undefined);
const optOutCapturing = mock(() => undefined);
const reset = mock(() => undefined);
const setConfig = mock(() => undefined);
const startSessionRecording = mock(() => undefined);
const stopSessionRecording = mock(() => undefined);

const posthog = {
  capture,
  featureFlags: {
    hasLoadedFlags: false,
    overrideFeatureFlags,
  },
  get_distinct_id: () => "visitor-id",
  get_session_id: () => "session-id",
  init,
  isFeatureEnabled: (key: string) => {
    const value = featureFlagOverrides[key];
    return value === undefined ? undefined : value !== false;
  },
  onFeatureFlags: (listener: () => void) => {
    featureFlagListeners.add(listener);
    return () => {
      featureFlagListeners.delete(listener);
    };
  },
  onSessionId: () => () => undefined,
  opt_in_capturing: optInCapturing,
  opt_out_capturing: optOutCapturing,
  reset,
  set_config: setConfig,
  startSessionRecording,
  stopSessionRecording,
};

mock.module("posthog-js", () => ({ default: posthog }));

describe("PostHogAnalytics feature flag overrides", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("keeps server and hydrated values aligned across consent and configuration changes", async () => {
    const [{ PostHogAnalytics }, { useFeatureFlagEnabled }] = await Promise.all(
      [import("./posthog-analytics"), import("@/features/feature-flags/react")]
    );

    const DiscountCodesProbe = ({
      initialEnabled,
    }: {
      initialEnabled: boolean;
    }) => {
      const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);

      return <>{enabled && <form aria-label="Discount code" />}</>;
    };

    const view = render(
      <PostHogAnalytics
        analyticsAccepted={false}
        featureFlagOverrides={{ discount_codes: true }}
        posthogEnvironment="preview"
      >
        <DiscountCodesProbe initialEnabled />
      </PostHogAnalytics>
    );

    expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();
    expect(init).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(
        <PostHogAnalytics
          analyticsAccepted
          featureFlagOverrides={{ discount_codes: true }}
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      );
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith({
      flags: { discount_codes: true },
    });
    expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();

    const { captureWorkspaceActionTransportError } = await import(
      "@/shared/utils/use-workspace-action"
    );
    class TransportDefect {
      readonly detail = "untrusted-object-detail";
    }
    const dynamicError = new Error("untrusted-error-message");
    dynamicError.name = "untrusted-error-name";
    for (const error of [
      dynamicError,
      "untrusted-primitive-defect",
      "https://invalid.example/untrusted-url-value",
      ["untrusted-array-value"],
      { nested: "untrusted-container-value" },
      new TransportDefect(),
    ]) {
      captureWorkspaceActionTransportError({
        actionName: "checkout.submit",
        error,
      });
    }
    expect(capture).toHaveBeenCalledTimes(6);
    expect(sentEvents).toHaveLength(6);
    const serializedEvents = JSON.stringify(sentEvents);
    for (const unsafeValue of [
      "untrusted-error-message",
      "untrusted-error-name",
      "untrusted-primitive-defect",
      "untrusted-url-value",
      "untrusted-array-value",
      "untrusted-container-value",
      "untrusted-object-detail",
    ]) {
      expect(serializedEvents).not.toContain(unsafeValue);
    }
    expect(serializedEvents).toContain('"errorCategory":"transport_failure"');

    await act(async () => {
      view.rerender(
        <PostHogAnalytics
          analyticsAccepted
          featureFlagOverrides={{ discount_codes: false }}
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      );
    });

    await waitFor(() => {
      expect(view.queryByRole("form", { name: "Discount code" })).toBeNull();
    });
    expect(init).toHaveBeenCalledTimes(1);
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith({
      flags: { discount_codes: false },
    });

    await act(async () => {
      view.rerender(
        <PostHogAnalytics analyticsAccepted posthogEnvironment="preview">
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      );
    });

    await waitFor(() => {
      expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();
    });
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith(false);

    const overrideCallCount = overrideFeatureFlags.mock.calls.length;
    await act(async () => {
      view.rerender(
        <PostHogAnalytics
          analyticsAccepted={false}
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      );
    });

    expect(overrideFeatureFlags).toHaveBeenCalledTimes(overrideCallCount);
    expect(stopSessionRecording).toHaveBeenCalled();
    expect(optOutCapturing).toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith(true);
  });
});
