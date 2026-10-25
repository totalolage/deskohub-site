export const TAG_MANAGER_IDLE_TIMEOUT_MS = 3000;
// Safari, including every iOS browser, still ships requestIdleCallback
// disabled. A fixed delay cannot detect idleness, so wait out the usual
// post-load hydration work without holding the container back for the full
// worst-case idle timeout, which would drop more page views from quick visits.
export const TAG_MANAGER_FALLBACK_IDLE_DELAY_MS = 1000;

const TAG_MANAGER_SCRIPT_ID = "google-tag-manager";
const INTERACTION_EVENTS = [
  "pointerdown",
  "keydown",
  "scroll",
  "touchstart",
] as const;
// The container's link-click and form-submit triggers only observe events
// after it runs, so pointing at or focusing one of their targets loads it early
// enough to see the click or submit that usually follows.
const TRIGGER_INTENT_EVENTS = ["pointerover", "focusin"] as const;
const TRIGGER_TARGET_SELECTOR = 'a[href^="mailto:"], form';
const INTERACTION_LISTENER_OPTIONS = { capture: true, passive: true };

// Keeps Tag Manager out of the critical loading window: the container loads
// once the page is idle after `load`, or on the first interaction if sooner.
// It drains already-queued dataLayer events when it loads, and its consent
// initialization tag reads the consent cookie itself.
export function scheduleTagManagerLoad(containerId: string): () => void {
  if (globalThis.window === undefined || isTagManagerLoaded()) {
    return () => undefined;
  }

  let cancelIdleLoad: (() => void) | undefined;

  const removeListeners = () => {
    window.removeEventListener("load", scheduleIdleLoad);
    for (const eventType of INTERACTION_EVENTS) {
      window.removeEventListener(eventType, load, INTERACTION_LISTENER_OPTIONS);
    }
    for (const eventType of TRIGGER_INTENT_EVENTS) {
      window.removeEventListener(
        eventType,
        loadOnTriggerIntent,
        INTERACTION_LISTENER_OPTIONS
      );
    }
  };

  const cancel = () => {
    removeListeners();
    cancelIdleLoad?.();
    cancelIdleLoad = undefined;
  };

  function load() {
    cancel();
    loadTagManager(containerId);
  }

  function loadOnTriggerIntent(event: Event) {
    if (
      event.target instanceof Element &&
      event.target.closest(TRIGGER_TARGET_SELECTOR)
    ) {
      load();
    }
  }

  function scheduleIdleLoad() {
    window.removeEventListener("load", scheduleIdleLoad);
    cancelIdleLoad = whenIdle(load);
  }

  for (const eventType of INTERACTION_EVENTS) {
    window.addEventListener(eventType, load, INTERACTION_LISTENER_OPTIONS);
  }
  for (const eventType of TRIGGER_INTENT_EVENTS) {
    window.addEventListener(
      eventType,
      loadOnTriggerIntent,
      INTERACTION_LISTENER_OPTIONS
    );
  }
  if (document.readyState === "complete") {
    scheduleIdleLoad();
  } else {
    window.addEventListener("load", scheduleIdleLoad);
  }

  return cancel;
}

function whenIdle(callback: () => void): () => void {
  if (window.requestIdleCallback) {
    const handle = window.requestIdleCallback(callback, {
      timeout: TAG_MANAGER_IDLE_TIMEOUT_MS,
    });
    return () => window.cancelIdleCallback(handle);
  }

  const handle = window.setTimeout(
    callback,
    TAG_MANAGER_FALLBACK_IDLE_DELAY_MS
  );
  return () => window.clearTimeout(handle);
}

function isTagManagerLoaded() {
  return document.getElementById(TAG_MANAGER_SCRIPT_ID) !== null;
}

function loadTagManager(containerId: string) {
  if (isTagManagerLoaded()) return;

  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ "gtm.start": Date.now(), event: "gtm.js" });

  const script = document.createElement("script");
  script.id = TAG_MANAGER_SCRIPT_ID;
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`;
  document.head.appendChild(script);
}
