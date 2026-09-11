import type { PostHog } from "posthog-js";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import type { CustomerAccountId } from "@/features/account/customer-account";

export const getPostHogAccountDistinctId = (
  accountId: CustomerAccountId
): string => `workspace-account:${accountId}`;

export type PostHogIdentityClient = Pick<
  PostHog,
  | "get_distinct_id"
  | "get_property"
  | "identify"
  | "opt_in_capturing"
  | "opt_out_capturing"
  | "reset"
>;

export type PostHogIdentityController = {
  readonly isReady: () => boolean;
  readonly reconcile: (
    consented: boolean,
    identity: AnalyticsAccountIdentity
  ) => void;
};

export type PostHogIdentityControllerOptions = {
  readonly onPause: () => void;
  readonly onReady: () => void;
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
  { onPause, onReady }: PostHogIdentityControllerOptions
): PostHogIdentityController {
  let ready = false;
  let pauseWasNotified = false;
  let readyIdentity: SettledAnalyticsAccountIdentity | undefined;
  let consentWasWithdrawn = false;
  let identityAssociationNeeded = false;

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
        client.reset(true);
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
        return;
      }
    }

    if (ready) pause();

    if (identity.status === "anonymous") {
      if (readUserState() === "identified") {
        client.reset(true);
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
      client.reset(true);
    }

    client.opt_in_capturing({ captureEventName: false });

    if (shouldIdentify) {
      ready = true;
      client.identify(desiredDistinctId);
    } else {
      ready = true;
    }

    identityAssociationNeeded = false;
    finishReady(identity);
  };

  return {
    isReady: () => ready,
    reconcile,
  };
}
