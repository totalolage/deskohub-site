import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/shared/components/unsaved-changes-guard";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const signOut = mock(() => Promise.resolve({ error: null }));

mock.module("@/features/account/auth.client", () => ({
  authClient: { signOut },
}));

registerWorkspaceComponentTestEnv();

const originalConfirm = window.confirm;
const originalAssign = window.location.assign;
const originalNavigationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "navigation"
);

function DirtyForm() {
  useUnsavedChanges({
    enabled: true,
    isDirty: () => true,
    message: "Leave this form?",
  });
  return <input aria-label="Dirty form" />;
}

function installNavigation() {
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  return navigation;
}

function dispatchNavigate(
  navigation: EventTarget,
  url: string,
  sameDocument = false
) {
  const event = new Event("navigate", { cancelable: true });
  Object.defineProperties(event, {
    canIntercept: { value: sameDocument },
    destination: { value: { sameDocument, url } },
    downloadRequest: { value: null },
    formData: { value: null },
    hashChange: { value: false },
    navigationType: { value: "push" },
    signal: { value: new AbortController().signal },
    sourceElement: { value: null },
    userInitiated: { value: false },
  });
  navigation.dispatchEvent(event);
  return event;
}

function restoreNavigation() {
  if (originalNavigationDescriptor) {
    Object.defineProperty(window, "navigation", originalNavigationDescriptor);
  } else {
    Reflect.deleteProperty(window, "navigation");
  }
}

beforeEach(() => {
  window.location.href = "http://localhost/account";
  signOut.mockClear();
  window.confirm = originalConfirm;
});

afterEach(() => {
  cleanup();
  window.confirm = originalConfirm;
  window.location.assign = originalAssign;
  restoreNavigation();
  document.body.innerHTML = "";
});

afterAll(unregisterWorkspaceComponentTestEnv);

test("rejects a dirty sign-out before auth mutation or navigation", async () => {
  const confirm = mock(() => false);
  window.confirm = confirm;
  let assigned: string | null = null;
  window.location.assign = ((href: string) => {
    assigned = href;
  }) as typeof window.location.assign;

  const { SignOutButton } = await import("./sign-out-button");
  const view = render(
    <UnsavedChangesProvider>
      <DirtyForm />
      <SignOutButton locale="cs-CZ" />
    </UnsavedChangesProvider>
  );

  await act(async () => {
    fireEvent.click(view.getByRole("button", { name: "Odhlásit se" }));
  });

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(signOut).not.toHaveBeenCalled();
  expect(assigned).toBeNull();
});

test("keeps an accepted sign-out approval through deferred auth and navigation", async () => {
  const navigation = installNavigation();
  const confirm = mock(() => true);
  window.confirm = confirm;
  let resolveSignOut!: (result: { error: null }) => void;
  const pendingSignOut = new Promise<{ error: null }>((resolve) => {
    resolveSignOut = resolve;
  });
  signOut.mockImplementationOnce(() => pendingSignOut);
  let assigned: string | null = null;
  window.location.assign = ((href: string) => {
    assigned = href;
  }) as typeof window.location.assign;

  const { SignOutButton } = await import("./sign-out-button");
  const view = render(
    <UnsavedChangesProvider>
      <DirtyForm />
      <SignOutButton locale="cs-CZ" />
    </UnsavedChangesProvider>
  );
  const button = view.getByRole("button", { name: "Odhlásit se" });

  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(signOut).toHaveBeenCalledTimes(1);
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(assigned).toBeNull();

  await act(async () => {
    resolveSignOut({ error: null });
    await pendingSignOut;
  });

  expect(assigned).toBe("/cs-CZ");
  const navigate = dispatchNavigate(
    navigation,
    new URL("/cs-CZ", window.location.href).href
  );

  expect(navigate.defaultPrevented).toBe(false);
  expect(confirm).toHaveBeenCalledTimes(1);
});
