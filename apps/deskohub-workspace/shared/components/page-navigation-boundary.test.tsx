import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let bfcacheId = "bfcache-1";
let selectedLayoutSegment: string | null = null;

mock.module("next/navigation", () => ({
  useRouter: () => ({ bfcacheId }),
  useSelectedLayoutSegment: () => selectedLayoutSegment,
}));

function Draft() {
  const [draft, setDraft] = useState("");

  return (
    <input
      aria-label="Draft"
      onInput={(event) => setDraft(event.currentTarget.value)}
      value={draft}
    />
  );
}

beforeAll(registerWorkspaceComponentTestEnv);

beforeEach(() => {
  bfcacheId = "bfcache-1";
  selectedLayoutSegment = null;
});

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

test("remounts the page subtree when the navigation id changes", async () => {
  const { PageNavigationBoundary } = await import("./page-navigation-boundary");
  const view = render(
    <PageNavigationBoundary>
      <Draft />
    </PageNavigationBoundary>
  );

  fireEvent.input(view.getByLabelText("Draft"), {
    target: { value: "unfinished draft" },
  });
  expect(view.getByDisplayValue("unfinished draft")).toBeTruthy();

  bfcacheId = "bfcache-2";
  view.rerender(
    <PageNavigationBoundary>
      <Draft />
    </PageNavigationBoundary>
  );

  expect(view.queryByDisplayValue("unfinished draft")).toBeNull();
});

test("preserves the page subtree when the navigation id is unchanged", async () => {
  const { PageNavigationBoundary } = await import("./page-navigation-boundary");
  const view = render(
    <PageNavigationBoundary>
      <Draft />
    </PageNavigationBoundary>
  );

  fireEvent.input(view.getByLabelText("Draft"), {
    target: { value: "unfinished draft" },
  });
  expect(view.getByDisplayValue("unfinished draft")).toBeTruthy();

  view.rerender(
    <PageNavigationBoundary>
      <Draft />
    </PageNavigationBoundary>
  );

  expect(view.getByDisplayValue("unfinished draft")).toBeTruthy();
});

test("preserves the page subtree when the navigation id changes under a persistent segment", async () => {
  const { PageNavigationBoundary } = await import("./page-navigation-boundary");
  selectedLayoutSegment = "account";
  const view = render(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  fireEvent.input(view.getByLabelText("Draft"), {
    target: { value: "unfinished draft" },
  });
  const draft = view.getByLabelText("Draft");

  bfcacheId = "bfcache-2";
  view.rerender(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  expect(view.getByLabelText("Draft")).toBe(draft);
  expect(view.getByDisplayValue("unfinished draft")).toBeTruthy();
});

test("remounts the page subtree when the navigation id changes outside a persistent segment", async () => {
  const { PageNavigationBoundary } = await import("./page-navigation-boundary");
  selectedLayoutSegment = "reservations";
  const view = render(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  fireEvent.input(view.getByLabelText("Draft"), {
    target: { value: "unfinished draft" },
  });

  bfcacheId = "bfcache-2";
  view.rerender(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  expect(view.queryByDisplayValue("unfinished draft")).toBeNull();
});

test("resets the page subtree when navigating from a persistent segment to another segment", async () => {
  const { PageNavigationBoundary } = await import("./page-navigation-boundary");
  selectedLayoutSegment = "account";
  const view = render(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  fireEvent.input(view.getByLabelText("Draft"), {
    target: { value: "unfinished draft" },
  });

  selectedLayoutSegment = "contact";
  view.rerender(
    <PageNavigationBoundary persistentSegments={["account"]}>
      <Draft />
    </PageNavigationBoundary>
  );

  expect(view.queryByDisplayValue("unfinished draft")).toBeNull();
});
