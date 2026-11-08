import { describe, expect, test } from "bun:test";
import { ErrorState, RefreshingIndicator } from "./async-states";
import { elementTree, findAll } from "./testing/element-tree";

/** The component's live region: its only Text with a role. */
const liveRegion = <Props,>(
  component: Parameters<typeof elementTree<Props>>[0],
  props: Props
) =>
  findAll(elementTree(component, props), "Text").find(
    (text) => text.props.role !== undefined
  )?.props;

// React Native's Text doesn't map `aria-live` to Android's live region, so
// each region declares `accessibilityLiveRegion` as well.
describe("live regions", () => {
  test("the error state's region is an assertive alert", () => {
    const region = liveRegion(ErrorState, {
      message: "x",
      retryLabel: "retry",
      onRetry: () => undefined,
    });
    expect(region?.role).toBe("alert");
    expect(region?.["aria-live"]).toBe("assertive");
    expect(region?.accessibilityLiveRegion).toBe("assertive");
  });

  test("the refreshing indicator's region is a polite status, idle or shown", () => {
    for (const refreshing of [false, true]) {
      const region = liveRegion(RefreshingIndicator, {
        refreshing,
        label: "refreshing",
      });
      expect(region?.role).toBe("status");
      expect(region?.["aria-live"]).toBe("polite");
      expect(region?.accessibilityLiveRegion).toBe("polite");
    }
  });
});
