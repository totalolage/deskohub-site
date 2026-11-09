import { describe, expect, test } from "bun:test";
import { AsyncResult } from "effect/unstable/reactivity";
import { Children, isValidElement, type ReactNode } from "react";
import { AppLocaleProvider } from "../i18n/locale-context";
import { LoadingState } from "../ui/async-states";
import { elementTree } from "../ui/testing/element-tree";
import { AsyncView } from "./async-view";
import type { CustomerRequestFailure } from "./customer-view-error";

function Pending() {
  return null;
}
function Content() {
  return null;
}

/** The component types AsyncView shows for `result`, in order. */
const shown = (
  result: AsyncResult.AsyncResult<string, CustomerRequestFailure>,
  loading?: ReactNode
) => {
  const tree = elementTree(
    AsyncView<string, CustomerRequestFailure>,
    {
      result,
      onRetry: () => undefined,
      loading,
      children: () => <Content />,
    },
    (probe) => <AppLocaleProvider locale="en-US">{probe}</AppLocaleProvider>
  );
  if (!isValidElement<{ children?: ReactNode }>(tree))
    throw new Error("no element");
  return Children.toArray(tree.props.children).flatMap((child) =>
    isValidElement(child) ? [child.type] : []
  );
};

describe("AsyncView's first load", () => {
  test("shows the spinner by default", () => {
    const types = shown(AsyncResult.initial(true));
    expect(types).toContain(LoadingState);
    expect(types).not.toContain(Content);
  });

  test("shows the screen's own loading content instead of the spinner", () => {
    const types = shown(AsyncResult.initial(true), <Pending />);
    expect(types).toContain(Pending);
    expect(types).not.toContain(LoadingState);
  });

  test("replaces the loading content with the data once it arrives", () => {
    const types = shown(AsyncResult.success("order"), <Pending />);
    expect(types).toContain(Content);
    expect(types).not.toContain(Pending);
  });
});
