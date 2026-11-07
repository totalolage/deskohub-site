import { createContext, type ReactNode, useContext } from "react";
import type { AppLocale } from "./app-locale";

const AppLocaleContext = createContext<AppLocale | null>(null);

export function AppLocaleProvider({
  locale,
  children,
}: {
  readonly locale: AppLocale;
  readonly children: ReactNode;
}) {
  return (
    <AppLocaleContext.Provider value={locale}>
      {children}
    </AppLocaleContext.Provider>
  );
}

export function useAppLocale(): AppLocale {
  const locale = useContext(AppLocaleContext);
  if (locale === null) {
    throw new Error("useAppLocale needs an AppLocaleProvider above it.");
  }
  return locale;
}
