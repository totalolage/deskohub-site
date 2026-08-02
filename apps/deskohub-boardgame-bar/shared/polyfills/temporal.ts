import { Temporal } from "@js-temporal/polyfill";

if (!globalThis.Temporal) {
  Object.defineProperty(globalThis, "Temporal", {
    configurable: true,
    writable: true,
    value: Temporal,
  });
}
