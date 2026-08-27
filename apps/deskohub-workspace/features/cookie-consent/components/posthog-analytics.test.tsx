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
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN = "phc_test";
process.env.NEXT_PUBLIC_POSTHOG_HOST = "https://posthog.example";

const featureFlagListeners = new Set<() => void>();
let featureFlagOverrides: Readonly<Record<string, boolean | string>> = {};

const init = mock(() => undefined);
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
    const [{ PostHogAnalytics, PostHogProvider }, { useFeatureFlagEnabled }] =
      await Promise.all([
        import("./posthog-analytics"),
        import("@/features/feature-flags/react"),
      ]);

    const DiscountCodesProbe = ({
      initialEnabled,
    }: {
      initialEnabled: boolean;
    }) => {
      const enabled = useFeatureFlagEnabled("discount_codes", initialEnabled);

      return <>{enabled && <form aria-label="Discount code" />}</>;
    };

    const AnalyticsBoundary = ({
      analyticsAccepted,
      discountCodesOverride,
    }: {
      analyticsAccepted: boolean;
      discountCodesOverride?: boolean;
    }) => (
      <PostHogProvider>
        <PostHogAnalytics
          analyticsAccepted={analyticsAccepted}
          featureFlagOverrides={
            discountCodesOverride === undefined
              ? undefined
              : { discount_codes: discountCodesOverride }
          }
          posthogEnvironment="preview"
        >
          <DiscountCodesProbe initialEnabled />
        </PostHogAnalytics>
      </PostHogProvider>
    );

    const view = render(
      <AnalyticsBoundary analyticsAccepted={false} discountCodesOverride />
    );

    expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();
    expect(init).not.toHaveBeenCalled();
    expect(overrideFeatureFlags).not.toHaveBeenCalled();

    await act(async () => {
      view.rerender(
        <AnalyticsBoundary analyticsAccepted discountCodesOverride />
      );
    });

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      "phc_test",
      expect.objectContaining({ capture_pageview: "history_change" })
    );
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith({
      flags: { discount_codes: true },
    });
    expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();

    await act(async () => {
      view.rerender(
        <AnalyticsBoundary analyticsAccepted discountCodesOverride={false} />
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
      view.rerender(<AnalyticsBoundary analyticsAccepted />);
    });

    await waitFor(() => {
      expect(view.getByRole("form", { name: "Discount code" })).toBeDefined();
    });
    expect(overrideFeatureFlags).toHaveBeenLastCalledWith(false);

    const overrideCallCount = overrideFeatureFlags.mock.calls.length;
    await act(async () => {
      view.rerender(<AnalyticsBoundary analyticsAccepted={false} />);
    });

    expect(overrideFeatureFlags).toHaveBeenCalledTimes(overrideCallCount);
    expect(stopSessionRecording).toHaveBeenCalled();
    expect(optOutCapturing).toHaveBeenCalled();
    expect(reset).toHaveBeenCalledWith(true);
  });
});
