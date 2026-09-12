import { afterAll, afterEach, beforeEach, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { Activity, StrictMode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { StickySection } from "./sticky-section";

registerWorkspaceComponentTestEnv();

type ObserveCall = {
  readonly options: ResizeObserverOptions | undefined;
  readonly target: Element;
};

class MockResizeObserver {
  readonly callback: ResizeObserverCallback;
  readonly observeCalls: ObserveCall[] = [];
  disconnectCallCount = 0;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
    observers.push(this);
  }

  observe(target: Element, options?: ResizeObserverOptions) {
    this.observeCalls.push({ options, target });
  }

  unobserve() {}

  disconnect() {
    this.disconnectCallCount += 1;
  }

  notify(target: Element, height: number) {
    const entry = {
      borderBoxSize: [{ blockSize: height, inlineSize: 0 }],
      contentRect: { height: 1 } as DOMRectReadOnly,
      target,
    } as ResizeObserverEntry;
    this.callback([entry], this);
  }
}

const observers: MockResizeObserver[] = [];
const originalGetBoundingClientRect =
  HTMLElement.prototype.getBoundingClientRect;
const originalResizeObserver = globalThis.ResizeObserver;

beforeEach(() => {
  observers.length = 0;
  globalThis.ResizeObserver = MockResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({
      height: 240,
    }) as DOMRect;
});

afterEach(() => {
  cleanup();
  globalThis.ResizeObserver = originalResizeObserver;
  HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
});

afterAll(unregisterWorkspaceComponentTestEnv);

test("sets its initial border-box height before paint", () => {
  const view = render(
    <StickySection>
      <span>Profile</span>
    </StickySection>
  );
  const section = view.getByText("Profile").parentElement;
  if (!section) throw new Error("Sticky section was not rendered");

  expect(section.style.getPropertyValue("--sticky-section-height")).toBe(
    "240px"
  );
  expect(observers[0]?.observeCalls).toEqual([
    { options: { box: "border-box" }, target: section },
  ]);
});

test("updates its height when the border-box size changes", () => {
  const view = render(
    <StickySection>
      <span>Reservations</span>
    </StickySection>
  );
  const section = view.getByText("Reservations").parentElement;
  const observer = observers[0];
  if (!section || !observer) throw new Error("Sticky section was not observed");

  observer.notify(section, 320);

  expect(section.style.getPropertyValue("--sticky-section-height")).toBe(
    "320px"
  );
});

test("disconnects observers during StrictMode and Activity cleanup", () => {
  const view = render(
    <StrictMode>
      <Activity mode="visible">
        <StickySection>
          <span>Account</span>
        </StickySection>
      </Activity>
    </StrictMode>
  );

  const strictModeReplayObserver = observers[0];
  const activeObserver = observers[1];
  if (!strictModeReplayObserver || !activeObserver) {
    throw new Error("StrictMode did not create the expected observers");
  }
  expect(strictModeReplayObserver.disconnectCallCount).toBe(1);
  expect(activeObserver.disconnectCallCount).toBe(0);

  view.rerender(
    <StrictMode>
      <Activity mode="hidden">
        <StickySection>
          <span>Account</span>
        </StickySection>
      </Activity>
    </StrictMode>
  );

  expect(activeObserver.disconnectCallCount).toBe(1);
});

test("uses responsive sticky positioning and the bounded top formula", () => {
  const originalTopDescriptor = Object.getOwnPropertyDescriptor(
    CSSStyleDeclaration.prototype,
    "top"
  );
  const originalTopSetter = originalTopDescriptor?.set;
  if (!originalTopDescriptor || !originalTopSetter) {
    throw new Error("CSSStyleDeclaration.top is not writable");
  }

  const topValues: string[] = [];
  Object.defineProperty(CSSStyleDeclaration.prototype, "top", {
    ...originalTopDescriptor,
    set(this: CSSStyleDeclaration, value: string) {
      topValues.push(value);
      originalTopSetter.call(this, value);
    },
  });

  try {
    const view = render(
      <StickySection>
        <span>Details</span>
      </StickySection>
    );
    const section = view.getByText("Details").parentElement;
    if (!section) throw new Error("Sticky section was not rendered");

    expect(section.dataset.slot).toBe("sticky-section");
    expect(section.className).toBe("lg:sticky lg:self-start");
    expect(topValues.at(-1)).toBe(
      "min(calc(var(--site-header-height) + 1.5rem), calc(100dvh - var(--sticky-section-height, 0px) - 1.5rem))"
    );
  } finally {
    Object.defineProperty(
      CSSStyleDeclaration.prototype,
      "top",
      originalTopDescriptor
    );
  }
});
