import { Temporal } from "@js-temporal/polyfill";

// The `<head>` loader requests this script only where Temporal is missing or
// incomplete, so it replaces whatever native Temporal there is.
Object.defineProperty(globalThis, "Temporal", {
  configurable: true,
  writable: true,
  value: Temporal,
});
