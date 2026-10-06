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

/**
 * Fallback envelope returned directly by the avatar stubs after their own
 * initial `recordInvocation`, so each invocation counts exactly once; the
 * shared `unavailable` wrapper would increment a second time.
 */
const unavailableAvatarResult: UnavailableActionResult = {
  serverError: unavailableMessage,
};

/**
 * Controlled outcome for the synthetic avatar mutation stubs. The capture flow
 * sets it on the page before driving the real AvatarControl interactions;
 * "unavailable" is the safe fallback when no outcome was requested. A pending
 * outcome returns a promise that never resolves, so `isExecuting` — and the
 * pending aria-live state — holds for the page's lifetime.
 */
type AccountVisualAvatarOutcome =
  | "pending-upload"
  | "pending-remove"
  | "uploaded"
  | "removed"
  | "retryable-upload"
  | "unavailable";

const globalScopeWithAvatar = globalThis as typeof globalThis & {
  __accountVisualAvatarOutcome?: AccountVisualAvatarOutcome;
};

/**
 * Entirely synthetic 96x96 two-tone PNG (data URL). Never a real customer
 * photo; it only proves the real <img> renders instead of initials.
 */
const syntheticAvatarDataUrl =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAGAAAABgCAYAAADimHc4AAAACXBIWXMAAAPoAAAD6AG1e1JrAAABp0lEQVR4nO3SQRUDMBACUd4a3ANOarSSWhmTBA4Y+IO+H/86YwYqvjn82Qb4kvgNYBa/AcziN4BZ/AYwi98AZvEbwCx+A5jFbwCz+A1gFr8BzOI3gFn8BjCL3wBm8RvALH4DmMVvALP4DWAWvwHM4jeAWfwGMIvfAGbxG8AsfgOYxW8As/gNYBa/AcziN4BZ/AYwi98AZvEbwCx+egDR+MkBRMMnBxCNnhxANHhyANHYyQFEQycHEI2cHEA0cHIA0bjJAUTDJgcQjZocQDRocgDRmMkBREMmBxCNmBxANGByANF4yQFEwyUHEI2WHEA0WHIA0VjJAURDJQcQjZQcQDRQcgDROMkBRMMkBxCNkhxANEhyANEYyQFEQyQHEI2QHEA0AL3ib2YA/HlzyIq/WQHwx81hK/5mBMCfNoeu+Pt2APxhc/iKv28GwJ81l6z4+1YA/FFz2Yq/bwTAnzSXrvh7dwD8QXP5ir93BsCfM4+s+HtXAPwx89iKv3cEwJ8yj674e3YA/CHz+Iq/ZwbAnzEhK/6eFQB/xISt+HtGAPwJE7riLxrgDxvcNqv5Gx4sAAAAAElFTkSuQmCC";

const avatarOutcome = (): AccountVisualAvatarOutcome =>
  globalScopeWithAvatar.__accountVisualAvatarOutcome ?? "unavailable";

/**
 * Resolves with the real `CustomerAvatarMutationResult` success payloads
 * wrapped in the next-safe-action transport envelope the component consumes.
 */
export const uploadCustomerAvatar = async (): Promise<unknown> => {
  actionTracker.recordInvocation();
  const outcome = avatarOutcome();
  if (outcome === "pending-upload") return new Promise<never>(() => {});
  if (outcome === "uploaded") {
    return {
      data: { status: "uploaded", avatar: { url: syntheticAvatarDataUrl } },
    };
  }
  if (outcome === "retryable-upload") {
    return { data: { status: "retryable" } };
  }
  return unavailableAvatarResult;
};

export const removeCustomerAvatar = async (): Promise<unknown> => {
  actionTracker.recordInvocation();
  const outcome = avatarOutcome();
  if (outcome === "pending-remove") return new Promise<never>(() => {});
  if (outcome === "removed") return { data: { status: "removed" } };
  return unavailableAvatarResult;
};

export const completeCustomerProfile = unavailable;
export const updateCustomerProfile = unavailable;
export const deleteCustomerAccount = unavailable;
export const saveMarketingPreferencesAction = unavailable;
export const confirmMarketingManagementAction = unavailable;
export const clearMarketingManagementAction = unavailable;
