// A failed chunk load is retried once the browser is back online or the tab
// regains focus; events captured meanwhile keep waiting.
const sdkLoadRetryEvents = ["focus", "online"] as const;

/**
 * Loads the PostHog SDK chunk for one effect run and hands the loaded module
 * to `onLoad`. After a failed load, `retry` runs on the next focus or online
 * event. The returned cleanup ignores a load that settles later and stops
 * listening for retries.
 */
export function loadPostHogSdk<Sdk>({
  load,
  onLoad,
  retry,
}: {
  readonly load: () => Promise<Sdk>;
  readonly onLoad: (sdk: Sdk) => void;
  readonly retry: () => void;
}): () => void {
  let current = true;
  load().then(
    (sdk) => {
      if (current) onLoad(sdk);
    },
    () => {
      if (!current) return;
      for (const event of sdkLoadRetryEvents) {
        window.addEventListener(event, retry);
      }
    }
  );

  return () => {
    current = false;
    for (const event of sdkLoadRetryEvents) {
      window.removeEventListener(event, retry);
    }
  };
}
