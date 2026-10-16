"use client";

import { createContext, type ReactNode, use } from "react";
import { baseLocale, type Locale } from "./paraglide/runtime.js";

// Route params are request data on dynamic routes, so reading them in a client
// component outside Suspense blocks prerendering. The root layout knows the
// locale from its static params and provides it instead.
const RouteLocaleContext = createContext<Locale>(baseLocale);

export function RouteLocaleProvider({
  children,
  locale,
}: {
  readonly children: ReactNode;
  readonly locale: Locale;
}) {
  return <RouteLocaleContext value={locale}>{children}</RouteLocaleContext>;
}

/** The `[locale]` segment of the current route, for client components. */
export const useRouteLocale = (): Locale => use(RouteLocaleContext);
