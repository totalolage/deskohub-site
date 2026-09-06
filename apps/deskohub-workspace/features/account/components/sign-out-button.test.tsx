import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { useState } from "react";
import {
  UnsavedChangesProvider,
  useUnsavedChanges,
} from "@/shared/components/unsaved-changes-guard";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

type SignOutResult = {
  readonly error: null | {
    readonly message?: string;
    readonly status?: number;
  };
};

const signOut = mock(
  (): Promise<SignOutResult> => Promise.resolve({ error: null })
);

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
  const [draft, setDraft] = useState("initial draft");

  useUnsavedChanges({
    enabled: true,
    isDirty: () => draft.length > 0,
    message: "Leave this form?",
  });
  return (
    <input
      aria-label="Dirty form"
      value={draft}
      onChange={(event) => setDraft(event.currentTarget.value)}
    />
  );
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
  sameDocument = false,
  navigationType: "push" | "traverse" = "push"
) {
  const event = new Event("navigate", { cancelable: true });
  Object.defineProperties(event, {
    canIntercept: { value: sameDocument },
    destination: { value: { sameDocument, url } },
    downloadRequest: { value: null },
    formData: { value: null },
    hashChange: { value: false },
    navigationType: { value: navigationType },
    signal: { value: new AbortController().signal },
    sourceElement: { value: null },
    userInitiated: { value: false },
  });
  navigation.dispatchEvent(event);
  return event;
}

function dispatchBeforeUnload(): Event {
  const event = new Event("beforeunload", { cancelable: true });
  Object.defineProperty(event, "returnValue", {
    configurable: true,
    value: "",
    writable: true,
  });
  window.dispatchEvent(event);
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
  signOut.mockImplementation(() => Promise.resolve({ error: null }));
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

test("allows one unload after deferred sign-out succeeds", async () => {
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
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  await act(async () => {
    resolveSignOut({ error: null });
    await pendingSignOut;
  });

  expect(assigned).toBe("/cs-CZ");
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(1);
});

test("does not navigate when sign-out resolves with a 503 error", async () => {
  const navigation = installNavigation();
  const confirm = mock(() => true);
  window.confirm = confirm;
  signOut.mockImplementationOnce(() =>
    Promise.resolve({
      error: { message: "service unavailable", status: 503 },
    })
  );
  let assigned: string | null = null;
  window.location.assign = ((href: string) => {
    assigned = href;
  }) as typeof window.location.assign;

  const { SignOutButton } = await import("./sign-out-button");
  const view = render(
    <UnsavedChangesProvider>
      <DirtyForm />
      <SignOutButton locale="en-US" />
    </UnsavedChangesProvider>
  );
  const button = view.getByRole("button", { name: "Sign out" });

  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(assigned).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(view.getByRole("alert").textContent).toBe(
    "We could not sign you out. Please try again."
  );
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  const draft = view.getByLabelText("Dirty form") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(draft, { target: { value: "later draft" } });
  });
  confirm.mockReturnValue(false);
  const navigate = dispatchNavigate(
    navigation,
    new URL("/en-US", window.location.href).href,
    true,
    "traverse"
  );

  expect(navigate.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(draft.value).toBe("later draft");
});

test("restores the button after a rejected sign-out without exposing the error", async () => {
  const navigation = installNavigation();
  const confirm = mock(() => true);
  window.confirm = confirm;
  let rejectSignOut!: (error: Error) => void;
  const rejectedSignOut = new Promise<SignOutResult>((_, reject) => {
    rejectSignOut = reject;
  });
  signOut.mockImplementationOnce(() => rejectedSignOut);
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
    rejectSignOut(new Error("raw provider failure"));
    await rejectedSignOut.catch(() => undefined);
  });

  expect(signOut).toHaveBeenCalledTimes(1);
  expect(assigned).toBeNull();
  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(view.getByRole("alert").textContent).toBe(
    "Odhlášení se nepodařilo. Zkuste to prosím znovu."
  );
  expect(view.getByRole("alert").textContent).not.toContain(
    "raw provider failure"
  );
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  const draft = view.getByLabelText("Dirty form") as HTMLInputElement;
  await act(async () => {
    fireEvent.change(draft, { target: { value: "later draft" } });
  });
  confirm.mockReturnValue(false);
  const navigate = dispatchNavigate(
    navigation,
    new URL("/cs-CZ", window.location.href).href,
    true,
    "traverse"
  );

  expect(navigate.defaultPrevented).toBe(true);
  expect(confirm).toHaveBeenCalledTimes(2);
  expect(draft.value).toBe("later draft");
});

test("retries a failed sign-out and navigates after the next success", async () => {
  const confirm = mock(() => true);
  window.confirm = confirm;
  signOut
    .mockImplementationOnce(() =>
      Promise.resolve({ error: { status: 503, message: "unavailable" } })
    )
    .mockImplementationOnce(() => Promise.resolve({ error: null }));
  let assigned: string | null = null;
  window.location.assign = ((href: string) => {
    assigned = href;
  }) as typeof window.location.assign;

  const { SignOutButton } = await import("./sign-out-button");
  const view = render(
    <UnsavedChangesProvider>
      <DirtyForm />
      <SignOutButton locale="en-US" />
    </UnsavedChangesProvider>
  );
  const button = view.getByRole("button", { name: "Sign out" });

  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });

  expect((button as HTMLButtonElement).disabled).toBe(false);
  expect(view.getByRole("alert")).toBeTruthy();

  await act(async () => {
    fireEvent.click(button);
    await Promise.resolve();
  });

  expect(signOut).toHaveBeenCalledTimes(2);
  expect(assigned).toBe("/en-US");
  expect((button as HTMLButtonElement).disabled).toBe(true);
  expect(view.queryByRole("alert")).toBeNull();
});
