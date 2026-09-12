import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import {
  cleanup,
  createEvent,
  fireEvent,
  render,
} from "@testing-library/react";
import {
  type ComponentPropsWithoutRef,
  createRef,
  type ReactNode,
  type Ref,
} from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

type NavigateEvent = {
  readonly preventDefault: () => void;
};

type MockLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: NavigateEvent) => void;
  readonly ref?: Ref<HTMLAnchorElement>;
};

function MockNextLink({
  href,
  onNavigate,
  children,
  ref,
  ...props
}: MockLinkProps) {
  return (
    <a ref={ref} href={href} {...props} onClick={onNavigate}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const { UnsavedChangesProvider, useUnsavedChanges } = await import(
  "./unsaved-changes-guard"
);
const { GuardedLink } = await import("./guarded-link");

const originalConfirm = window.confirm;
let confirmMock: ReturnType<typeof mock>;

function Guard({ dirty }: { readonly dirty: boolean }) {
  useUnsavedChanges({
    enabled: true,
    isDirty: () => dirty,
    message: "Leave this form?",
  });
  return null;
}

function withProvider(children: ReactNode) {
  return (
    <UnsavedChangesProvider>
      <Guard dirty />
      {children}
    </UnsavedChangesProvider>
  );
}

function invokeNavigate() {
  const link = document.querySelector("a");
  if (!link) throw new Error("Next Link not rendered");
  const event = createEvent.click(link);
  fireEvent(link, event);
  return { event, prevented: event.defaultPrevented };
}

beforeEach(() => {
  window.location.href = "http://localhost/form";
  confirmMock = mock((_message?: string) => false);
  window.confirm = confirmMock;
});

afterEach(() => {
  cleanup();
  window.confirm = originalConfirm;
});

afterAll(() => {
  unregisterWorkspaceComponentTestEnv();
});

test("prevents changed client navigation and does not call the caller after rejection", () => {
  let callerCalls = 0;
  render(
    withProvider(
      <GuardedLink href="/next" onNavigate={() => callerCalls++}>
        Next
      </GuardedLink>
    )
  );

  const result = invokeNavigate();

  expect(result.prevented).toBe(true);
  expect(callerCalls).toBe(0);
  expect(confirmMock).toHaveBeenCalledWith("Leave this form?");
});

test("calls the caller after accepting changed client navigation", () => {
  confirmMock.mockReturnValue(true);
  let receivedEvent: NavigateEvent | undefined;
  render(
    withProvider(
      <GuardedLink
        href="/next?step=2"
        onNavigate={(event) => {
          receivedEvent = event;
        }}
      >
        Next
      </GuardedLink>
    )
  );

  const result = invokeNavigate();

  expect(result.prevented).toBe(false);
  expect(receivedEvent).toBeTruthy();
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("allows exact-page and hash-only links without confirmation", () => {
  let callerCalls = 0;
  const view = render(
    withProvider(
      <GuardedLink href="/form" onNavigate={() => callerCalls++}>
        Current
      </GuardedLink>
    )
  );

  invokeNavigate();
  view.rerender(
    withProvider(
      <GuardedLink href="/form#details" onNavigate={() => callerCalls++}>
        Details
      </GuardedLink>
    )
  );
  invokeNavigate();

  expect(callerCalls).toBe(2);
  expect(confirmMock).not.toHaveBeenCalled();
});

test("preserves the href, forwarded aria props, and ref", () => {
  const ref = createRef<HTMLAnchorElement>();
  const view = render(
    withProvider(
      <GuardedLink
        ref={ref}
        href="/next"
        aria-label="Go to next"
        data-testid="guarded-link"
      >
        Next
      </GuardedLink>
    )
  );

  const link = view.getByRole("link", { name: "Go to next" });
  expect(link.getAttribute("href")).toBe("/next");
  expect(link.getAttribute("aria-label")).toBe("Go to next");
  expect(link.getAttribute("data-testid")).toBe("guarded-link");
  expect(ref.current).toBe(link);
});

test("lets the caller cancel an accepted navigation through the public contract", () => {
  confirmMock.mockReturnValue(true);
  render(
    withProvider(
      <GuardedLink href="/next" onNavigate={(event) => event.preventDefault()}>
        Next
      </GuardedLink>
    )
  );

  expect(invokeNavigate().prevented).toBe(true);
});
