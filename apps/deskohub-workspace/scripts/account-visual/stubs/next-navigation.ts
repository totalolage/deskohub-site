import { useSyncExternalStore } from "react";

type Subscriber = () => void;

const subscribers = new Set<Subscriber>();
let revision = 0;

const notify = () => {
  revision += 1;
  for (const subscriber of subscribers) subscriber();
};

const subscribe = (subscriber: Subscriber) => {
  subscribers.add(subscriber);
  return () => subscribers.delete(subscriber);
};

const getSnapshot = () => `${window.location.href}:${revision}`;

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
