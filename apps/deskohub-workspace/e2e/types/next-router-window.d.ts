// The Next.js App Router exposes its client router on `window.next`; E2E
// suites drive navigation through it inside page.evaluate callbacks.
declare global {
  interface Window {
    next?: {
      router?: {
        prefetch(href: string): void;
        push(href: string): void;
      };
    };
  }
}

export {};
