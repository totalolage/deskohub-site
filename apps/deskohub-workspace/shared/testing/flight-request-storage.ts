import { AsyncLocalStorage } from "node:async_hooks";

// Next's server runtime gives React's Flight renderer a global
// AsyncLocalStorage, so `cache()` keeps a request's entries across awaits.
// Bun has none; import this before the renderer so a fixture renders the way
// a deployment does.
if (!("AsyncLocalStorage" in globalThis)) {
  Object.assign(globalThis, { AsyncLocalStorage });
}
