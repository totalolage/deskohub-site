import {
  afterAll,
  afterEach,
  beforeEach,
  expect,
  mock,
  spyOn,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement, type ReactNode, StrictMode } from "react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const {
  UnsavedChangesProvider,
  useAllowNextUnload,
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

function CallbackGuard({ isDirty }: { readonly isDirty: () => boolean }) {
  useUnsavedChanges({
    enabled: true,
    isDirty,
    message: "Latest state?",
  });
  return null;
}

type UnloadControls = {
  readonly allowNextUnload: () => void;
  readonly confirm: () => boolean;
};

function UnloadController({
  onReady,
}: {
  readonly onReady: (controls: UnloadControls) => void;
}) {
  onReady({
    allowNextUnload: useAllowNextUnload(),
    confirm: useConfirmDiscardChanges(),
  });
  return null;
}

function withProvider(children: ReactNode) {
  return createElement(UnsavedChangesProvider, null, children);
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
  readonly hashChange?: boolean;
  readonly navigationType?: "push" | "replace" | "reload" | "traverse";
  readonly sameDocument?: boolean;
  readonly url: string;
};

function installNavigation() {
  // Happy DOM cannot run Next's asynchronous navigation, so tests dispatch the standard event.
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
    hashChange = false,
    navigationType = "traverse",
    sameDocument = true,
    url,
  }: NavigateTestOptions
) {
  const event = new Event("navigate", { cancelable });
  Object.defineProperties(event, {
    destination: { value: { sameDocument, url } },
    hashChange: { value: hashChange },
    navigationType: { value: navigationType },
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

test("does not prompt or block a clean guard", () => {
  render(withProvider(createElement(Guard, { dirty: false })));

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("does not attach listeners while all guards are clean", () => {
  const navigation = installNavigation();
  const addWindowListener = spyOn(window, "addEventListener");
  const addNavigationListener = spyOn(navigation, "addEventListener");

  render(withProvider(createElement(Guard, { dirty: false })));

  expect(addWindowListener).not.toHaveBeenCalledWith(
    "beforeunload",
    expect.any(Function)
  );
  expect(addNavigationListener).not.toHaveBeenCalledWith(
    "navigate",
    expect.any(Function)
  );
  addWindowListener.mockRestore();
  addNavigationListener.mockRestore();
});

test("blocks unload while an enabled mounted guard is dirty", () => {
  render(withProvider(createElement(Guard, { dirty: true })));

  const event = dispatchBeforeUnload();

  expect(event.defaultPrevented).toBe(true);
});

test("attaches listeners when a guard is dirty", () => {
  const navigation = installNavigation();
  const addWindowListener = spyOn(window, "addEventListener");
  const addNavigationListener = spyOn(navigation, "addEventListener");

  render(withProvider(createElement(Guard, { dirty: true })));

  expect(addWindowListener).toHaveBeenCalledWith(
    "beforeunload",
    expect.any(Function)
  );
  expect(addNavigationListener).toHaveBeenCalledWith(
    "navigate",
    expect.any(Function)
  );
  addWindowListener.mockRestore();
  addNavigationListener.mockRestore();
});

test("ignores disabled guards", () => {
  render(withProvider(createElement(Guard, { dirty: true, enabled: false })));

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(window.confirm).not.toHaveBeenCalled();
});

test("uses the latest dirty callback through the stable registration", () => {
  let isDirty = () => true;
  const view = render(withProvider(createElement(CallbackGuard, { isDirty })));

  isDirty = () => false;
  view.rerender(withProvider(createElement(CallbackGuard, { isDirty })));

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
});

test("removes listeners when a registered form becomes clean", () => {
  const navigation = installNavigation();
  const removeWindowListener = spyOn(window, "removeEventListener");
  const removeNavigationListener = spyOn(navigation, "removeEventListener");
  const view = render(withProvider(createElement(Guard, { dirty: true })));

  view.rerender(withProvider(createElement(Guard, { dirty: false })));

  expect(removeWindowListener).toHaveBeenCalledWith(
    "beforeunload",
    expect.any(Function)
  );
  expect(removeNavigationListener).toHaveBeenCalledWith(
    "navigate",
    expect.any(Function)
  );
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  removeWindowListener.mockRestore();
  removeNavigationListener.mockRestore();
});

test("uses the first dirty guard's native confirmation", () => {
  let controls: UnloadControls | undefined;

  render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: false, message: "First" }),
      createElement(Guard, { dirty: true, message: "Second" }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  if (!controls) throw new Error("Confirmation hook not ready");
  expect(controls.confirm()).toBe(false);
  expect(confirmMock).toHaveBeenCalledWith("Second");
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("pure confirmation does not affect later traverses", () => {
  const navigation = installNavigation();
  let confirm: (() => boolean) | undefined;
  render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(UnloadController, {
        onReady: ({ confirm: currentConfirm }) => {
          confirm = currentConfirm;
        },
      })
    )
  );

  confirmMock.mockReturnValue(true);
  if (!confirm) throw new Error("Confirmation hook not ready");
  expect(confirm()).toBe(true);

  confirmMock.mockReturnValue(false);
  const laterBack = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });

  expect(laterBack.defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(2);
});

test("only handles cancelable same-document non-hash traverses", () => {
  const navigation = installNavigation();
  render(withProvider(createElement(Guard, { dirty: true })));

  const nonCancelable = dispatchNavigate(navigation, {
    cancelable: false,
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });
  const push = dispatchNavigate(navigation, {
    navigationType: "push",
    url: new URL("/next", window.location.href).href,
  });
  const hash = dispatchNavigate(navigation, {
    hashChange: true,
    navigationType: "traverse",
    url: new URL("/form#details", window.location.href).href,
  });
  const documentNavigation = dispatchNavigate(navigation, {
    navigationType: "traverse",
    sameDocument: false,
    url: new URL("/next", window.location.href).href,
  });
  const reload = dispatchNavigate(navigation, {
    navigationType: "reload",
    url: window.location.href,
  });
  const traverse = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });

  expect(nonCancelable.defaultPrevented).toBe(false);
  expect(push.defaultPrevented).toBe(false);
  expect(hash.defaultPrevented).toBe(false);
  expect(documentNavigation.defaultPrevented).toBe(false);
  expect(reload.defaultPrevented).toBe(false);
  expect(traverse.defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("consumes an unload bypass once after explicit confirmation succeeds", () => {
  let controls: UnloadControls | undefined;
  render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  confirmMock.mockReturnValue(true);
  if (!controls) throw new Error("Unload hooks not ready");
  expect(controls.confirm()).toBe(true);
  controls.allowNextUnload();

  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("does not set an unload bypass while all guards are clean", () => {
  let controls: UnloadControls | undefined;
  const view = render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: false }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  if (!controls) throw new Error("Unload hooks not ready");
  controls.allowNextUnload();
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);

  view.rerender(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("clears the unload bypass when the last dirty guard detaches", () => {
  let controls: UnloadControls | undefined;
  const view = render(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  confirmMock.mockReturnValue(true);
  if (!controls) throw new Error("Unload hooks not ready");
  controls.confirm();
  controls.allowNextUnload();

  view.rerender(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );
  view.rerender(
    createElement(
      UnsavedChangesProvider,
      null,
      createElement(Guard, { dirty: true }),
      createElement(UnloadController, {
        onReady: (currentControls) => {
          controls = currentControls;
        },
      })
    )
  );

  expect(dispatchBeforeUnload().defaultPrevented).toBe(true);
});

test("cleans listeners and registrations under StrictMode", () => {
  const navigation = installNavigation();
  const view = render(
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

  const traverse = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });

  expect(traverse.defaultPrevented).toBe(true);
  expect(confirmMock).toHaveBeenCalledTimes(1);

  view.unmount();
  expect(dispatchBeforeUnload().defaultPrevented).toBe(false);
  const afterUnmount = dispatchNavigate(navigation, {
    navigationType: "traverse",
    url: new URL("/previous", window.location.href).href,
  });
  expect(afterUnmount.defaultPrevented).toBe(false);
  expect(confirmMock).toHaveBeenCalledTimes(1);
});

test("defaults to allowing confirmation outside a provider", () => {
  let controls: UnloadControls | undefined;
  render(
    createElement(UnloadController, {
      onReady: (currentControls) => {
        controls = currentControls;
      },
    })
  );

  if (!controls) throw new Error("Confirmation hook not ready");
  expect(controls.confirm()).toBe(true);
  expect(window.confirm).not.toHaveBeenCalled();
});
