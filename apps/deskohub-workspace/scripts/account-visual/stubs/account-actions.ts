import { m } from "../../../features/i18n";

const unavailableMessage =
  "Unavailable in component renderer: backend action was not executed.";

/**
 * Controlled outcome for the synthetic ARES lookup stub. The capture flow sets
 * it on the page before activating the lookup control; "unavailable" is the
 * safe fallback when no outcome was requested.
 */
type AccountVisualAresOutcome =
  | "loading"
  | "found"
  | "invalid-ico"
  | "not-found"
  | "unavailable";

const globalScopeWithAres = globalThis as typeof globalThis & {
  __accountVisualAresOutcome?: AccountVisualAresOutcome;
};

/**
 * Fixed synthetic registry company. Provider-faithful shape of
 * `AresBusinessBillingDraft` with entirely fictional data; never real ARES
 * registry data.
 */
const syntheticAresCompany = {
  companyName: "Vzorková s.r.o.",
  companyId: "27082440",
  vatId: "CZ27082440",
  addressLine1: "Vzorková 42",
  addressLine2: "Staré Město",
  city: "Praha",
  zip: "110 00",
  country: "CZ",
} as const;

export const lookupAresBusiness = async (): Promise<unknown> => {
  actionTracker.recordInvocation();
  const outcome =
    globalScopeWithAres.__accountVisualAresOutcome ?? "unavailable";
  if (outcome === "loading") return new Promise<void>(() => {});
  if (outcome === "found") {
    return {
      data: {
        status: "found",
        company: syntheticAresCompany,
      },
    };
  }
  const locale =
    document.documentElement.lang === "cs-CZ"
      ? ("cs-CZ" as const)
      : ("en-US" as const);
  const message = (() => {
    if (outcome === "invalid-ico")
      return m.accountAresLookupInvalidIco({}, { locale });
    if (outcome === "not-found")
      return m.accountAresLookupNotFound({}, { locale });
    return m.accountAresLookupUnavailable({}, { locale });
  })();
  return { data: { status: outcome, message } };
};

type AccountVisualActionTracker = {
  readonly invocationCount: number;
  readonly recordInvocation: () => void;
};

const globalScope = globalThis as typeof globalThis & {
  readonly __accountVisualActionTracker?: AccountVisualActionTracker;
};

const actionTracker =
  globalScope.__accountVisualActionTracker ??
  (() => {
    let invocationCount = 0;
    const tracker = {
      get invocationCount() {
        return invocationCount;
      },
      recordInvocation() {
        invocationCount += 1;
      },
    } as const satisfies AccountVisualActionTracker;
    Object.defineProperty(globalThis, "__accountVisualActionTracker", {
      configurable: false,
      enumerable: false,
      value: tracker,
      writable: false,
    });
    return tracker;
  })();

type UnavailableActionResult = {
  readonly data?: undefined;
  readonly serverError: string;
};

const unavailable = async (): Promise<UnavailableActionResult> => {
  actionTracker.recordInvocation();
  return { serverError: unavailableMessage };
};

export const completeCustomerProfile = unavailable;
export const updateCustomerProfile = unavailable;
export const deleteCustomerAccount = unavailable;
export const saveMarketingPreferencesAction = unavailable;
export const confirmMarketingManagementAction = unavailable;
export const clearMarketingManagementAction = unavailable;
