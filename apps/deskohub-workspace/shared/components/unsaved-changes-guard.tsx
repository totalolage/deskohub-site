"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

type UnsavedChangesOptions = {
  readonly enabled: boolean;
  readonly isDirty: () => boolean;
  readonly message: string;
};

type GuardRegistration = {
  readonly enabled: () => boolean;
  readonly isDirty: () => boolean;
  readonly message: () => string;
};

type UnsavedChangesContextValue = {
  readonly confirm: (destination?: string) => boolean;
  readonly register: (registration: GuardRegistration) => () => void;
  readonly sync: () => void;
};

type NavigationApproval = {
  readonly destination: string;
};

type DocumentNavigationApproval = {
  readonly destination: string;
  readonly onAbort?: () => void;
  readonly signal?: AbortSignal;
};

type ProviderState = {
  readonly context: UnsavedChangesContextValue;
  readonly cleanup: () => void;
};

const defaultContext: UnsavedChangesContextValue = {
  confirm: () => true,
  register: () => () => {},
  sync: () => {},
};

const UnsavedChangesContext = createContext(defaultContext);

function parseURL(value: string, base: string) {
  try {
    return new URL(value, base);
  } catch {
    return null;
  }
}

function leavesPathOrQuery(destination: URL, current: URL) {
  return (
    destination.origin === current.origin &&
    (destination.pathname !== current.pathname ||
      destination.search !== current.search)
  );
}

export function UnsavedChangesProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const registrationsRef = useRef(new Set<GuardRegistration>());
  const listenersAttachedRef = useRef(false);
  const navigationRef = useRef<Navigation | null>(null);
  const approvalRef = useRef<NavigationApproval | null>(null);
  const documentNavigationRef = useRef<DocumentNavigationApproval | null>(null);

  const [provider] = useState<ProviderState>(() => {
    function clearDocumentNavigation() {
      const approval = documentNavigationRef.current;
      if (approval?.signal && approval.onAbort) {
        approval.signal.removeEventListener("abort", approval.onAbort);
      }
      documentNavigationRef.current = null;
    }

    function clearApproval() {
      approvalRef.current = null;
      clearDocumentNavigation();
    }

    function allowDestination(destination: string) {
      clearApproval();
      approvalRef.current = { destination };
    }

    function allowDocumentNavigation(
      destination: string,
      signal?: AbortSignal
    ) {
      clearDocumentNavigation();
      let approval: DocumentNavigationApproval;
      const onAbort = () => {
        if (documentNavigationRef.current === approval) {
          clearDocumentNavigation();
        }
      };
      approval = { destination, onAbort, signal };
      documentNavigationRef.current = approval;

      if (signal?.aborted) {
        clearDocumentNavigation();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    }

    function allowClickedDestination(destination: string) {
      allowDestination(destination);
      if (navigationRef.current === null) {
        allowDocumentNavigation(destination);
      }
    }

    function matchesDestination(
      destination: URL | null,
      approval: NavigationApproval
    ) {
      return (
        destination?.href ===
        parseURL(approval.destination, window.location.href)?.href
      );
    }

    function hasDirtyRegistration() {
      for (const registration of registrationsRef.current) {
        if (registration.enabled() && registration.isDirty()) return true;
      }
      return false;
    }

    function confirmDiscardChanges(destination?: string) {
      for (const registration of registrationsRef.current) {
        if (!registration.enabled() || !registration.isDirty()) continue;
        if (!window.confirm(registration.message())) {
          clearApproval();
          return false;
        }
        break;
      }

      if (destination === undefined) clearApproval();
      else allowDestination(destination);
      return true;
    }

    function handleDocumentClick(event: MouseEvent) {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return;
      }

      if (!(event.target instanceof Element)) return;
      const anchor = event.target.closest("a[href]");
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const target = anchor.getAttribute("target")?.trim().toLowerCase();
      if (target && target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const current = parseURL(window.location.href, window.location.href);
      const destination = parseURL(anchor.href, window.location.href);
      if (
        !current ||
        !destination ||
        !leavesPathOrQuery(destination, current)
      ) {
        return;
      }

      clearApproval();
      if (!confirmDiscardChanges()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }

      allowClickedDestination(destination.href);
    }

    function handleNavigate(event: NavigateEvent) {
      if (documentNavigationRef.current) clearDocumentNavigation();

      const destination = parseURL(event.destination.url, window.location.href);
      const approval = approvalRef.current;

      if (approval && matchesDestination(destination, approval)) {
        if (event.defaultPrevented || event.signal?.aborted) {
          clearApproval();
          return;
        }

        approvalRef.current = null;
        if (!event.destination.sameDocument) {
          allowDocumentNavigation(approval.destination, event.signal);
        }
        return;
      }
      if (approval) clearApproval();

      if (
        !destination ||
        !event.destination.sameDocument ||
        event.hashChange ||
        event.downloadRequest != null ||
        event.defaultPrevented ||
        !event.cancelable
      ) {
        return;
      }

      const current = parseURL(window.location.href, window.location.href);
      if (!current || !leavesPathOrQuery(destination, current)) return;

      if (!confirmDiscardChanges()) event.preventDefault();
    }

    function handleNavigateError() {
      clearApproval();
    }

    function handleBeforeUnload(event: BeforeUnloadEvent) {
      if (documentNavigationRef.current) {
        clearApproval();
        return;
      }

      if (!hasDirtyRegistration()) return;
      event.preventDefault();
      event.returnValue = "";
    }

    function detachListeners() {
      if (!listenersAttachedRef.current) return;

      document.removeEventListener("click", handleDocumentClick, true);
      globalThis.removeEventListener("beforeunload", handleBeforeUnload);
      navigationRef.current?.removeEventListener("navigate", handleNavigate);
      navigationRef.current?.removeEventListener(
        "navigateerror",
        handleNavigateError
      );
      navigationRef.current = null;
      listenersAttachedRef.current = false;
    }

    function attachListeners() {
      if (listenersAttachedRef.current) return;

      document.addEventListener("click", handleDocumentClick, true);
      globalThis.addEventListener("beforeunload", handleBeforeUnload);

      const navigation = window.navigation;
      if (navigation) {
        navigation.addEventListener("navigate", handleNavigate);
        navigation.addEventListener("navigateerror", handleNavigateError);
        navigationRef.current = navigation;
      }
      listenersAttachedRef.current = true;
    }

    function refreshListeners() {
      if (hasDirtyRegistration()) attachListeners();
      else {
        clearApproval();
        detachListeners();
      }
    }

    function register(registration: GuardRegistration) {
      registrationsRef.current.add(registration);
      refreshListeners();

      return () => {
        registrationsRef.current.delete(registration);
        refreshListeners();
      };
    }

    function sync() {
      refreshListeners();
    }

    return {
      context: {
        confirm: confirmDiscardChanges,
        register,
        sync,
      },
      cleanup: () => {
        detachListeners();
        clearApproval();
        registrationsRef.current.clear();
      },
    };
  });

  useEffect(() => provider.cleanup, [provider]);

  return (
    <UnsavedChangesContext.Provider value={provider.context}>
      {children}
    </UnsavedChangesContext.Provider>
  );
}

export function useUnsavedChanges({
  enabled,
  isDirty,
  message,
}: UnsavedChangesOptions) {
  const context = useContext(UnsavedChangesContext);
  const optionsRef = useRef({ enabled, isDirty, message });
  const [registration] = useState<GuardRegistration>(() => ({
    enabled: () => optionsRef.current.enabled,
    isDirty: () => optionsRef.current.isDirty(),
    message: () => optionsRef.current.message,
  }));

  useLayoutEffect(() => {
    optionsRef.current = { enabled, isDirty, message };
    context.sync();
  });

  useEffect(() => context.register(registration), [context, registration]);
}

export function useConfirmDiscardChanges() {
  return useContext(UnsavedChangesContext).confirm;
}
