import { effectSmokeCases } from "./effect-smoke-cases";
import { intlSmokeCases } from "./intl-smoke-cases";
import { sharedSmokeCases } from "./shared-smoke-cases";
import type { SmokeCase } from "./smoke-case";

/** Every runtime smoke case the app runs, in display order. */
export const smokeCases: ReadonlyArray<SmokeCase> = [
  ...effectSmokeCases,
  ...sharedSmokeCases,
  ...intlSmokeCases,
];
