import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode, StrictMode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const {
  UnsavedChangesProvider,
  useCancelNavigationApproval,
  useConfirmDiscardChanges,
  useUnsavedChanges,
} = await import("./unsaved-changes-guard");

const originalConfirm = window.confirm;
const originalNavigationDescriptor = Object.getOwnPropertyDescriptor(
  window,
  "navigation"
);
let confirmMock: ReturnType<typeof mock>;

type GuardProps = {
  readonly dirty: boolean;
  readonly enabled?: boolean;
  readonly message?: string;
};

function Guard({
  dirty,
  enabled = true,
  message = "Leave this form?",
}: GuardProps) {
  useUnsavedChanges({
    enabled,
    isDirty: () => dirty,
    message,
  });
  return null;
}

function ConfirmationButton({
  onResult,
  destination,
}: {
  readonly onResult: (value: boolean) => void;
  readonly destination?: string;
}) {
  const confirmDiscardChanges = useConfirmDiscardChanges();
  return createElement(
    "button",
    {
      type: "button",
      onClick: () => onResult(confirmDiscardChanges(destination)),
    },
    "Confirm discard"
  );
}

type ConfirmDiscardChanges = (destination?: string) => boolean;

function ConfirmationController({
  onReady,
}: {
  readonly onReady: (confirm: ConfirmDiscardChanges) => void;
}) {
  onReady(useConfirmDiscardChanges());
  return null;
}

function CancellationController({
  onReady,
}: {
  readonly onReady: (cancel: () => void) => void;
}) {
  onReady(useCancelNavigationApproval());
  return null;
}

function withProvider(children: ReactNode) {
  return createElement(UnsavedChangesProvider, null, children);
}

function addLink(
  href: string,
  attributes: Readonly<Record<string, string>> = {}
) {
  const link = document.createElement("a");
  link.href = href;
  for (const [name, value] of Object.entries(attributes)) {
    link.setAttribute(name, value);
  }
  link.textContent = "Navigate";
  document.body.append(link);
  return link;
}

function dispatchClick(
  element: Element,
  init: MouseEventInit = {}
): MouseEvent {
  const event = new MouseEvent("click", {
    bubbles: true,
    cancelable: true,
    button: 0,
    ...init,
  });
  element.dispatchEvent(event);
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

type NavigateTestOptions = {
  readonly cancelable?: boolean;
  readonly downloadRequest?: string | null;
  readonly hashChange?: boolean;
  readonly navigationType?: "push" | "replace" | "reload" | "traverse";
  readonly signal?: AbortSignal;
  readonly sameDocument?: boolean;
  readonly url: string;
};

function installNavigation() {
  // Happy DOM cannot run Next's asynchronous navigation, so tests dispatch the standard events.
  const navigation = new EventTarget();
  Object.defineProperty(window, "navigation", {
    configurable: true,
    value: navigation,
  });
  return navigation;
}

function dispatchNavigate(
  navigation: EventTarget,
  {
    cancelable = true,
    downloadRequest = null,
    hashChange = false,
    navigationType = "traverse",
    signal,
    sameDocument = true,
    url,
  }: NavigateTestOptions
) {
  const event = new Event("navigate", { cancelable });
  Object.defineProperties(event, {
    canIntercept: { value: sameDocument },
    destination: { value: { sameDocument, url } },
    downloadRequest: { value: downloadRequest },
    formData: { value: null },
    hashChange: { value: hashChange },
    navigationType: { value: navigationType },
    signal: { value: signal ?? new AbortController().signal },
    sourceElement: { value: null },
    userInitiated: { value: false },
  });
  navigation.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  window.location.href = "http://localhost/form";
  confirmMock = mock((_message?: string) => false);
  window.confirm = confirmMock;
});

afterEach(() => {
  cleanup();
  window.confirm = originalConfirm;
  if (originalNavigationDescriptor) {
    Object.defineProperty(window, "navigation", originalNavigationDescriptor);
  } else {
    Reflect.deleteProperty(window, "navigation");
  }
  document.body.innerHTML = "";
});

afterAll(unregisterWorkspaceComponentTestEnv);

test("does not prompt or block navigation for a clean guard", () => {
  render(withProvider(createElement(Guard, { dirty: false })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());

  const click = dispatchClick(link);
  const beforeUnload = dispatchBeforeUnload();

  expect(click.cancelBubble).toBe(false);
  expect(beforeUnload.defaultPrevented).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("rejects dirty internal clicks before bubbling to navigation handlers", () => {
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next?step=2");
  let bubbleCount = 0;
  link.addEventListener("click", () => {
    bubbleCount += 1;
  });

  const click = dispatchClick(link);

  expect(click.defaultPrevented).toBe(true);
  expect(click.cancelBubble).toBe(true);
  expect(bubbleCount).toBe(0);
  expect(window.confirm).toHaveBeenCalledWith("Leave this form?");
});

test("accepts the clicked destination without prompting its navigate event again", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next?step=2#section");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  const click = dispatchClick(link);
  const navigate = dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  expect(click.cancelBubble).toBe(false);
  expect(navigate.defaultPrevented).toBe(false);
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("keeps an accepted click approval until delayed Next navigation", async () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next?step=2");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("keeps an accepted click approval through an empty-space click", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next?step=2");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  dispatchClick(document.body);
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("ignores hash-only, new-tab, download, and modified clicks", () => {
  render(withProvider(createElement(Guard, { dirty: true })));
  const hashLink = addLink("/form#details");
  const newTabLink = addLink("/next", { target: "_blank" });
  const downloadLink = addLink("/next.pdf", { download: "next.pdf" });
  const modifiedLink = addLink("/next");
  for (const link of [hashLink, newTabLink, downloadLink, modifiedLink]) {
    link.addEventListener("click", (event) => event.preventDefault());
  }

  expect(dispatchClick(hashLink).cancelBubble).toBe(false);
  expect(dispatchClick(newTabLink).cancelBubble).toBe(false);
  expect(dispatchClick(downloadLink).cancelBubble).toBe(false);
  expect(dispatchClick(modifiedLink, { ctrlKey: true }).cancelBubble).toBe(
    false
  );
  expect(window.confirm).not.toHaveBeenCalled();
});

test("cancels a dirty cancellable same-document traverse", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));

  const event = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });

  expect(event.defaultPrevented).toBe(true);
  expect(window.location.pathname).toBe("/form");
  expect(confirmMock).toHaveBeenCalledWith("Leave this form?");
});

test("does not try to cancel a non-cancellable traverse", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));

  const event = dispatchNavigate(navigation, {
    cancelable: false,
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });

  expect(event.defaultPrevented).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("prevents beforeunload only while a mounted guard is dirty", () => {
  const view = render(withProvider(createElement(Guard, { dirty: true })));

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  view.rerender(withProvider(createElement(Guard, { dirty: false })));
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

  view.rerender(withProvider(createElement(Guard, { dirty: true })));
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);

  view.unmount();
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
});

test("clears an approval before detaching the last inactive guard", () => {
  const navigation = installNavigation();
  let dirty = true;

  function DynamicGuard() {
    useUnsavedChanges({
      enabled: true,
      isDirty: () => dirty,
      message: "Leave this form?",
    });
    return null;
  }

  const view = render(withProvider(createElement(DynamicGuard)));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);
  dispatchClick(link);

  dirty = false;
  view.rerender(withProvider(createElement(DynamicGuard)));
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  dirty = true;
  view.rerender(withProvider(createElement(DynamicGuard)));
  confirmMock.mockReturnValue(false);
  const event = dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  expect(event.defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(2);
});

test("reads the latest dirty callback without replacing its registration", () => {
  let dirty = false;
  const isDirty = () => dirty;

  function StableGuard() {
    useUnsavedChanges({
      enabled: true,
      isDirty,
      message: "Latest state?",
    });
    return null;
  }

  const view = render(withProvider(createElement(StableGuard)));
  dirty = true;
  view.rerender(withProvider(createElement(StableGuard)));
  const link = addLink("/next");

  dispatchClick(link);

  expect(window.confirm).toHaveBeenCalledWith("Latest state?");
});

test("updates the dirty getter even when its boolean result did not change", () => {
  let dirty = true;
  let isDirty = () => true;

  function GetterGuard() {
    useUnsavedChanges({
      enabled: true,
      isDirty,
      message: "Latest getter?",
    });
    return null;
  }

  const view = render(withProvider(createElement(GetterGuard)));
  isDirty = () => dirty;
  view.rerender(withProvider(createElement(GetterGuard)));
  dirty = false;
  const link = addLink("/next");

  dispatchClick(link);

  expect(window.confirm).not.toHaveBeenCalled();
});

test("does not let an accepted click permission leak to another destination", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: new URL("/other", window.location.href).href,
  });

  expect(confirmMock).toHaveBeenCalledTimes(2);
  expect(confirmMock).toHaveBeenLastCalledWith("Leave this form?");
});

test("does not let an accepted click permission suppress an unrelated beforeunload", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(1);

  dispatchNavigate(navigation, {
    navigationType: "push",
    sameDocument: false,
    url: link.href,
  });

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("clears an accepted document navigation when its signal is aborted", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  const controller = new AbortController();
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  dispatchNavigate(navigation, {
    navigationType: "push",
    sameDocument: false,
    signal: controller.signal,
    url: link.href,
  });
  controller.abort();

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("invalidates an accepted document unload when another navigation starts", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  dispatchNavigate(navigation, {
    navigationType: "push",
    sameDocument: false,
    url: link.href,
  });
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: new URL("/other", window.location.href).href,
  });

  expect(confirmMock).toHaveBeenCalledTimes(2);
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("clears an accepted destination after a navigation error", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);

  dispatchClick(link);
  dispatchNavigate(navigation, {
    navigationType: "push",
    sameDocument: false,
    url: link.href,
  });
  navigation.dispatchEvent(new Event("navigateerror"));

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("records an accepted explicit destination and matches it exactly", () => {
  const navigation = installNavigation();
  let decision: boolean | undefined;
  const view = render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(ConfirmationButton, {
        destination: "/next?step=2",
        onResult: (value) => {
          decision = value;
        },
      })
    )
  );
  confirmMock.mockReturnValue(true);

  view.getByRole("button", { name: "Confirm discard" }).click();
  dispatchClick(document.body);
  const matching = dispatchNavigate(navigation, {
    navigationType: "push",
    url: new URL("/next?step=2", window.location.href).href,
  });
  const unrelated = dispatchNavigate(navigation, {
    navigationType: "push",
    url: new URL("/next?step=3", window.location.href).href,
  });

  expect(decision).toBe(true);
  expect(matching.defaultPrevented).toBe(false);
  expect(unrelated.defaultPrevented).toBe(false);
  expect(confirmMock).toHaveBeenCalledTimes(2);
});

test("a rejected explicit confirmation leaves no destination approval", () => {
  const navigation = installNavigation();
  let confirmDiscardChanges: ConfirmDiscardChanges | undefined;
  render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(ConfirmationController, {
        onReady: (confirm) => {
          confirmDiscardChanges = confirm;
        },
      })
    )
  );
  const link = addLink("/next");
  link.addEventListener("click", (event) => event.preventDefault());
  confirmMock.mockReturnValue(true);
  dispatchClick(link);

  confirmMock.mockReturnValue(false);
  if (!confirmDiscardChanges) throw new Error("Confirmation hook not ready");
  expect(confirmDiscardChanges("/other")).toBe(false);
  dispatchNavigate(navigation, {
    navigationType: "push",
    url: link.href,
  });

  expect(confirmMock).toHaveBeenCalledTimes(3);
});

test("cancels an accepted explicit destination approval", () => {
  const navigation = installNavigation();
  let cancelApproval: (() => void) | undefined;
  const view = render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(ConfirmationButton, {
        destination: "/next",
        onResult: () => {},
      }),
      createElement(CancellationController, {
        onReady: (cancel) => {
          cancelApproval = cancel;
        },
      })
    )
  );
  confirmMock.mockReturnValue(true);

  view.getByRole("button", { name: "Confirm discard" }).click();
  if (!cancelApproval) throw new Error("Cancellation hook not ready");
  cancelApproval();

  confirmMock.mockReturnValue(false);
  const navigate = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/next", window.location.href).href,
  });

  expect(navigate.defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(2);
});

test("reinstalls the guard listeners correctly under StrictMode", () => {
  render(
    createElement(
      StrictMode,
      null,
      createElement(
        UnsavedChangesProvider,
        null,
        createElement(Guard, { dirty: true })
      )
    )
  );
  const link = addLink("/next");

  dispatchClick(link);

  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("explicit confirmation checks the active guard and defaults open outside a provider", () => {
  let decision: boolean | undefined;
  const view = render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(ConfirmationButton, {
        onResult: (value) => {
          decision = value;
        },
      })
    )
  );

  view.getByRole("button", { name: "Confirm discard" }).click();
  expect(decision).toBe(false);
  expect(confirmMock).toHaveBeenCalledWith("Leave this form?");

  view.unmount();
  decision = undefined;
  const outside = render(
    createElement(ConfirmationButton, {
      onResult: (value) => {
        decision = value;
      },
    })
  );
  outside.getByRole("button", { name: "Confirm discard" }).click();

  expect(decision).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(1);
});
