import { useMemo, useSyncExternalStore } from "react";

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let revision = 0;

const notify = () => {
  revision += 1;
  for (const subscriber of subscribers) subscriber();
};

const handlePopState = () => notify();

const subscribe = (subscriber: Subscriber) => {
  subscribers.add(subscriber);
  if (subscribers.size === 1 && globalThis.window !== undefined) {
    window.addEventListener("popstate", handlePopState);
  }

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size === 0 && globalThis.window !== undefined) {
      window.removeEventListener("popstate", handlePopState);
    }
  };
};

const getSnapshot = () =>
  globalThis.window === undefined
    ? "server"
    : `${window.location.href}:${revision}`;

const getServerSnapshot = () => "server";

export const navigate = (href: string | URL, replace = false) => {
  const destination = new URL(String(href), window.location.href);
  if (destination.origin !== window.location.origin) {
    window.location.assign(destination.href);
    return;
  }

  const nextUrl = `${destination.pathname}${destination.search}${destination.hash}`;
  if (replace) window.history.replaceState(null, "", nextUrl);
  else window.history.pushState(null, "", nextUrl);
  notify();
};

const router = {
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  prefetch: async () => undefined,
  push: (href: string | URL) => navigate(href),
  refresh: notify,
  replace: (href: string | URL) => navigate(href, true),
};

export function useRouter() {
  return router;
}

export function useNavigationState() {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function usePathname() {
  useNavigationState();
  return globalThis.window === undefined ? null : window.location.pathname;
}

export function useSearchParams() {
  useNavigationState();
  const search = globalThis.window === undefined ? "" : window.location.search;

  return useMemo(() => new URLSearchParams(search), [search]);
}
