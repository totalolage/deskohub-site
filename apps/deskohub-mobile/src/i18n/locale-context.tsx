import { createContext, type ReactNode, useContext, useMemo } from "react";
import type { AppLocale } from "./app-locale";

interface AppLocaleValue {
  readonly locale: AppLocale;
  /** Shows a locale the customer saved to their account. */
  readonly choose: (locale: AppLocale) => void;
}

const AppLocaleContext = createContext<AppLocaleValue | null>(null);

const cannotChoose = () => {
  throw new Error("This AppLocaleProvider shows a fixed locale.");
};

/**
 * Gives screens the locale to show. The root passes the session's
 * (`useSessionLocale`) with its `choose`; tests pass a fixed locale.
 */
export function AppLocaleProvider({
  locale,
  choose = cannotChoose,
  children,
}: {
  readonly locale: AppLocale;
  readonly choose?: (locale: AppLocale) => void;
  readonly children: ReactNode;
}) {
  const value = useMemo(() => ({ locale, choose }), [locale, choose]);
  return (
    <AppLocaleContext.Provider value={value}>
      {children}
    </AppLocaleContext.Provider>
  );
}

const useAppLocaleValue = (): AppLocaleValue => {
  const value = useContext(AppLocaleContext);
  if (value === null) {
    throw new Error("useAppLocale needs an AppLocaleProvider above it.");
  }
  return value;
};

/**
 * The app's locale, or `undefined` outside an `AppLocaleProvider`, for
 * building blocks such as `Text` that component tests render alone.
 */
export function useProvidedAppLocale(): AppLocale | undefined {
  return useContext(AppLocaleContext)?.locale;
}

export function useAppLocale(): AppLocale {
  return useAppLocaleValue().locale;
}

/** Shows a locale the customer saved to their account (`active-locale.ts`). */
export function useChooseAppLocale(): (locale: AppLocale) => void {
  return useAppLocaleValue().choose;
}
