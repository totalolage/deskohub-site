import "server-only";

import { env } from "@/env";
import { SealedStateKeys } from "./sealed-state-keys.service";

export const makeSealedStateKeysLayer = () =>
  SealedStateKeys.fromConfiguration(env.CHECKOUT_PAY_STATE_KEYS);
