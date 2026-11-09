import type { DotyposCustomerId } from "@deskohub/dotypos/types";
import type { PostHog } from "posthog-js";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { getPostHogAccountDistinctId } from "@/features/account/posthog-account-distinct-id";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";

/**
 * Person property holding the account's opaque Dotypos customer ID, which
 * analysts join to Dotypos customer records. It never holds contact data.
 */
const dotyposCustomerIdPersonProperty = "dotypos_customer_id";

export type PostHogIdentityClient = Pick<
  PostHog,
  | "get_distinct_id"
  | "get_property"
  | "identify"
  | "opt_in_capturing"
  | "opt_out_capturing"
  | "reset"
  | "setInternalOrTestUser"
  | "setPersonProperties"
>;

export type PostHogIdentityController = {
  /**
   * Whether analytics is ready for `identity`: the controller settled on it
   * and the SDK still holds it.
   */
  readonly isReadyFor: (identity: AnalyticsAccountIdentity) => boolean;
  readonly reconcile: (
    consented: boolean,
    identity: AnalyticsAccountIdentity
  ) => void;
};

export type PostHogIdentityControllerOptions = {
  readonly deploymentEnvironment: DeploymentEnvironment;
  readonly onPause: () => void;
  readonly onReady: () => void;
  /** The account's Dotypos customer ID once known; undefined without one. */
  readonly readDotyposCustomerId?: (
    accountId: CustomerAccountId
  ) => DotyposCustomerId | undefined;
};

/** An account identity analytics can settle on. */
export type SettledAnalyticsAccountIdentity = Extract<
  AnalyticsAccountIdentity,
  { readonly status: "anonymous" | "authenticated" }
>;

type PostHogUserState = ReturnType<PostHogIdentityClient["get_property"]>;

export const isSettledAnalyticsAccountIdentity = (
  identity: AnalyticsAccountIdentity
): identity is SettledAnalyticsAccountIdentity =>
  identity.status === "anonymous" || identity.status === "authenticated";

/** Whether both name the anonymous visitor or the same account. */
export const sameSettledAnalyticsAccountIdentity = (
  left: SettledAnalyticsAccountIdentity,
  right: SettledAnalyticsAccountIdentity
): boolean => {
  if (left.status !== right.status) return false;
  if (left.status === "anonymous") return true;
  return right.status === "authenticated" && left.accountId === right.accountId;
};

const sdkMatchesSettledIdentity = (
  identity: SettledAnalyticsAccountIdentity,
  readDistinctId: () => string,
  readUserState: () => PostHogUserState
) => {
  if (identity.status === "anonymous") {
    return readUserState() !== "identified";
  }

  return (
    readDistinctId() === getPostHogAccountDistinctId(identity.accountId) &&
    readUserState() === "identified"
  );
};

type PostHogSdkIdentity = {
  readonly readDistinctId: () => string;
  readonly readUserState: () => PostHogUserState;
};

/** Reads the SDK's distinct ID and user state at most once per reconcile. */
const observeSdkIdentity = (
  client: PostHogIdentityClient
): PostHogSdkIdentity => {
  let observedDistinctId: string | undefined;
  let observedUserState: PostHogUserState;
  let userStateWasObserved = false;
  return {
    readDistinctId: () => {
      if (observedDistinctId === undefined) {
        observedDistinctId = client.get_distinct_id();
      }
      return observedDistinctId;
    },
    readUserState: () => {
      if (!userStateWasObserved) {
        observedUserState = client.get_property("$user_state");
        userStateWasObserved = true;
      }
      return observedUserState;
    },
  };
};

export function createPostHogIdentityController(
  client: PostHogIdentityClient,
  {
    deploymentEnvironment,
    onPause,
    onReady,
    readDotyposCustomerId,
  }: PostHogIdentityControllerOptions
): PostHogIdentityController {
  let ready = false;
  let pauseWasNotified = false;
  let readyIdentity: SettledAnalyticsAccountIdentity | undefined;
  let consentWasWithdrawn = false;
  let identityAssociationNeeded = false;
  // The person property last set since the SDK identity was last reset.
  let sentDotyposCustomer:
    | {
        readonly distinctId: string;
        readonly dotyposCustomerId: DotyposCustomerId;
      }
    | undefined;

  const resetClient = () => {
    client.reset(true);
    sentDotyposCustomer = undefined;
  };

  const syncDotyposCustomerId = (
    distinctId: string,
    accountId: CustomerAccountId
  ) => {
    const dotyposCustomerId = readDotyposCustomerId?.(accountId);
    if (
      dotyposCustomerId === undefined ||
      (sentDotyposCustomer?.distinctId === distinctId &&
        sentDotyposCustomer.dotyposCustomerId === dotyposCustomerId)
    ) {
      return;
    }

    client.setPersonProperties({
      [dotyposCustomerIdPersonProperty]: dotyposCustomerId,
    });
    sentDotyposCustomer = { distinctId, dotyposCustomerId };
  };

  const pause = () => {
    ready = false;
    readyIdentity = undefined;

    if (pauseWasNotified) return;

    pauseWasNotified = true;
    onPause();
  };

  const finishReady = (identity: SettledAnalyticsAccountIdentity) => {
    ready = true;
    readyIdentity = identity;
    pauseWasNotified = false;
    onReady();
  };

  const withdrawConsent = () => {
    pause();
    if (consentWasWithdrawn) return;

    resetClient();
    client.opt_out_capturing();
    consentWasWithdrawn = true;
    identityAssociationNeeded = true;
  };

  /**
   * Whether the ready identity still holds in the SDK, so nothing needs to
   * change. A customer link that loads after identify lands on the same
   * person.
   */
  const keepReadyIdentity = (
    identity: SettledAnalyticsAccountIdentity,
    sdk: PostHogSdkIdentity
  ) => {
    if (
      !ready ||
      !readyIdentity ||
      !sameSettledAnalyticsAccountIdentity(readyIdentity, identity) ||
      !sdkMatchesSettledIdentity(
        identity,
        sdk.readDistinctId,
        sdk.readUserState
      )
    ) {
      return false;
    }
    if (identity.status === "authenticated") {
      syncDotyposCustomerId(sdk.readDistinctId(), identity.accountId);
    }
    return true;
  };

  const settleAnonymous = (
    identity: Extract<SettledAnalyticsAccountIdentity, { status: "anonymous" }>,
    sdk: PostHogSdkIdentity
  ) => {
    if (sdk.readUserState() === "identified") {
      resetClient();
    }

    client.opt_in_capturing({ captureEventName: false });
    identityAssociationNeeded = false;
    finishReady(identity);
  };

  // Only production persons stay unmarked. Preview (including CI E2E) and
  // development share the production PostHog project.
  const markInternalOrTestPerson = (testAccount: boolean) => {
    if (testAccount || deploymentEnvironment !== "production") {
      client.setInternalOrTestUser();
    }
  };

  const settleAuthenticated = (
    identity: Extract<
      SettledAnalyticsAccountIdentity,
      { status: "authenticated" }
    >,
    sdk: PostHogSdkIdentity
  ) => {
    const distinctId = sdk.readDistinctId();
    const desiredDistinctId = getPostHogAccountDistinctId(identity.accountId);
    const sdkIsIdentified = sdk.readUserState() === "identified";
    const shouldIdentify =
      identityAssociationNeeded ||
      distinctId !== desiredDistinctId ||
      !sdkIsIdentified;

    if (shouldIdentify && sdkIsIdentified) {
      resetClient();
    }

    client.opt_in_capturing({ captureEventName: false });

    // The $identify event, and anything else the SDK emits while settling,
    // already belongs to the ready account.
    ready = true;
    readyIdentity = identity;
    if (shouldIdentify) {
      client.identify(desiredDistinctId);
    }

    markInternalOrTestPerson(identity.testAccount);
    syncDotyposCustomerId(desiredDistinctId, identity.accountId);

    identityAssociationNeeded = false;
    finishReady(identity);
  };

  const reconcile = (
    consented: boolean,
    identity: AnalyticsAccountIdentity
  ) => {
    if (!consented) {
      withdrawConsent();
      return;
    }

    consentWasWithdrawn = false;

    if (identity.status === "pending" || identity.status === "unavailable") {
      pause();
      return;
    }

    const sdk = observeSdkIdentity(client);
    if (keepReadyIdentity(identity, sdk)) return;

    if (ready) pause();

    if (identity.status === "anonymous") {
      settleAnonymous(identity, sdk);
    } else {
      settleAuthenticated(identity, sdk);
    }
  };

  const isReadyFor = (identity: AnalyticsAccountIdentity) => {
    if (!ready || !readyIdentity) return false;
    if (!isSettledAnalyticsAccountIdentity(identity)) return false;
    if (!sameSettledAnalyticsAccountIdentity(readyIdentity, identity)) {
      return false;
    }
    const sdk = observeSdkIdentity(client);
    return sdkMatchesSettledIdentity(
      identity,
      sdk.readDistinctId,
      sdk.readUserState
    );
  };

  return {
    isReadyFor,
    reconcile,
  };
}
