import { Layer } from "effect";
import {
  type AccountConsentCheck,
  CurrentAccountConsentCheck,
  createAccountConsentCheck,
} from "../account-consent-check";
import {
  type ConsentChoice,
  type ConsentStorage,
  createAnalyticsConsent,
  type StoredConsent,
} from "../analytics-consent";
import { DeviceAnalyticsConsent } from "../use-analytics-consent";

/** The instant a choice made on the fake device is dated at. */
export const fakeDeviceNow = new Date("2026-11-10T12:00:00.000Z");

/**
 * A device's analytics consent over in-memory storage that starts with
 * `stored` (read at once, or once `load` is called), its account consent
 * check signed in to `accountId`, and the layer that hands both to Effects.
 */
export const makeFakeDeviceConsent = ({
  stored,
  accountId,
  loadLater = false,
}: {
  readonly stored: StoredConsent;
  readonly accountId: string;
  readonly loadLater?: boolean;
}) => {
  let saved = stored;
  const writes: ConsentChoice[] = [];
  let load: (() => void) | undefined;
  const storage: ConsentStorage = {
    read: () =>
      loadLater
        ? new Promise<StoredConsent>((resolve) => {
            load = () => resolve(saved);
          })
        : saved,
    write: async (choice) => {
      writes.push(choice);
      saved = { kind: "decided", ...choice };
    },
  };
  const consent = createAnalyticsConsent(storage, () => {}, {
    now: () => fakeDeviceNow,
    locale: () => "en-US",
  });
  const check: AccountConsentCheck = createAccountConsentCheck(consent.current);
  check.follow(accountId);
  return {
    consent,
    check,
    /** Every choice saved to storage, in order. */
    writes,
    /** Finishes the stored answer's read, with `loadLater`. */
    load: () => load?.(),
    layer: Layer.mergeAll(
      Layer.succeed(DeviceAnalyticsConsent, consent),
      Layer.succeed(CurrentAccountConsentCheck, check)
    ),
  };
};
