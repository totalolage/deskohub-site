import type { DotyposCustomerId } from "@deskohub/dotypos/types";
import type { PostHog } from "posthog-js";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";

export const getPostHogAccountDistinctId = (
  accountId: CustomerAccountId
): string => `workspace-account:${accountId}`;

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
  readonly isReady: () => boolean;
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

type SettledAnalyticsAccountIdentity = Extract<
  AnalyticsAccountIdentity,
  { readonly status: "anonymous" | "authenticated" }
>;

type PostHogUserState = ReturnType<PostHogIdentityClient["get_property"]>;

const sameSettledIdentity = (
  left: SettledAnalyticsAccountIdentity,
  right: SettledAnalyticsAccountIdentity
) => {
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

  const reconcile = (
    consented: boolean,
    identity: AnalyticsAccountIdentity
  ) => {
    if (!consented) {
      pause();

      if (!consentWasWithdrawn) {
        resetClient();
        client.opt_out_capturing();
        consentWasWithdrawn = true;
        identityAssociationNeeded = true;
      }
      return;
    }

    consentWasWithdrawn = false;

    if (identity.status === "pending" || identity.status === "unavailable") {
      pause();
      return;
    }

    let observedDistinctId: string | undefined;
    let observedUserState: PostHogUserState;
    let userStateWasObserved = false;
    const readDistinctId = () => {
      if (observedDistinctId === undefined) {
        observedDistinctId = client.get_distinct_id();
      }
      return observedDistinctId;
    };
    const readUserState = () => {
      if (!userStateWasObserved) {
        observedUserState = client.get_property("$user_state");
        userStateWasObserved = true;
      }
      return observedUserState;
    };

    if (
      ready &&
      readyIdentity &&
      sameSettledIdentity(readyIdentity, identity)
    ) {
      if (sdkMatchesSettledIdentity(identity, readDistinctId, readUserState)) {
        // A customer link that loads after identify lands on the same person.
        if (identity.status === "authenticated") {
          syncDotyposCustomerId(readDistinctId(), identity.accountId);
        }
        return;
      }
    }

    if (ready) pause();

    if (identity.status === "anonymous") {
      if (readUserState() === "identified") {
        resetClient();
      }

      client.opt_in_capturing({ captureEventName: false });
      identityAssociationNeeded = false;
      finishReady(identity);
      return;
    }

    const distinctId = readDistinctId();
    const desiredDistinctId = getPostHogAccountDistinctId(identity.accountId);
    const sdkIsIdentified = readUserState() === "identified";
    const shouldIdentify =
      identityAssociationNeeded ||
      distinctId !== desiredDistinctId ||
      !sdkIsIdentified;

    if (shouldIdentify && sdkIsIdentified) {
      resetClient();
    }

    client.opt_in_capturing({ captureEventName: false });

    if (shouldIdentify) {
      ready = true;
      client.identify(desiredDistinctId);
    } else {
      ready = true;
    }

    // Only production persons stay unmarked. Preview (including CI E2E) and
    // development share the production PostHog project.
    if (identity.testAccount || deploymentEnvironment !== "production") {
      client.setInternalOrTestUser();
    }
    syncDotyposCustomerId(desiredDistinctId, identity.accountId);

    identityAssociationNeeded = false;
    finishReady(identity);
  };

  return {
    isReady: () => ready,
    reconcile,
  };
}
