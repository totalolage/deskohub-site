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
  readonly allowNextUnload: () => void;
  readonly confirm: () => boolean;
  readonly register: (registration: GuardRegistration) => () => void;
  readonly sync: () => void;
};

const defaultContext: UnsavedChangesContextValue = {
  allowNextUnload: () => {},
  confirm: () => true,
  register: () => () => {},
  sync: () => {},
};

const UnsavedChangesContext = createContext(defaultContext);

function hasDirtyGuard(registrations: ReadonlySet<GuardRegistration>) {
  return [...registrations].some(
    ({ enabled, isDirty }) => enabled() && isDirty()
  );
}

export function UnsavedChangesProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const registrationsRef = useRef(new Set<GuardRegistration>());
  const allowNextUnloadRef = useRef(false);
  const [hasDirty, setHasDirty] = useState(false);

  const [context] = useState<UnsavedChangesContextValue>(() => {
    const sync = () => {
      const dirty = hasDirtyGuard(registrationsRef.current);
      if (!dirty) allowNextUnloadRef.current = false;
      setHasDirty(dirty);
    };

    const confirm = () => {
      for (const registration of registrationsRef.current) {
        if (registration.enabled() && registration.isDirty()) {
          return window.confirm(registration.message());
        }
      }
      return true;
    };

    return {
      allowNextUnload: () => {
        if (hasDirtyGuard(registrationsRef.current))
          allowNextUnloadRef.current = true;
      },
      confirm,
      register: (registration) => {
        registrationsRef.current.add(registration);
        sync();

        return () => {
          registrationsRef.current.delete(registration);
          sync();
        };
      },
      sync,
    };
  });

  useEffect(() => {
    if (!hasDirty) return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasDirtyGuard(registrationsRef.current)) {
        allowNextUnloadRef.current = false;
        return;
      }
      if (allowNextUnloadRef.current) {
        allowNextUnloadRef.current = false;
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    };

    const handleNavigate = (event: NavigateEvent) => {
      if (
        event.defaultPrevented ||
        !event.cancelable ||
        !event.destination.sameDocument ||
        event.navigationType !== "traverse" ||
        event.hashChange
      ) {
        return;
      }

      if (!context.confirm()) event.preventDefault();
    };

    globalThis.addEventListener("beforeunload", handleBeforeUnload);
    const navigation = window.navigation;
    navigation?.addEventListener("navigate", handleNavigate);

    return () => {
      globalThis.removeEventListener("beforeunload", handleBeforeUnload);
      navigation?.removeEventListener("navigate", handleNavigate);
    };
  }, [context, hasDirty]);

  return (
    <UnsavedChangesContext.Provider value={context}>
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

export function useAllowNextUnload() {
  return useContext(UnsavedChangesContext).allowNextUnload;
}
