import { Temporal as TemporalPolyfill } from "@js-temporal/polyfill";

declare global {
  export import Temporal = TemporalPolyfill;
}
