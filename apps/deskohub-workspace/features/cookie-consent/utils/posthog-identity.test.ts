import { describe, expect, test } from "bun:test";
import type { AnalyticsAccountIdentity } from "@/features/account/analytics-identity";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  createPostHogIdentityController,
  type PostHogIdentityClient,
} from "./posthog-identity";

type PersistedUserState = "anonymous" | "identified";

const makeIdentity = (
  status: AnalyticsAccountIdentity["status"],
  accountId?: CustomerAccountId
): AnalyticsAccountIdentity => {
  if (status === "authenticated") {
    if (!accountId)
      throw new Error("An authenticated identity needs an account ID");
    return { accountId, status };
  }

  return { status };
};

const pending = makeIdentity("pending");
const unavailable = makeIdentity("unavailable");
const anonymous = makeIdentity("anonymous");

const makeFakeClient = (input: {
  readonly beforeIdentify?: () => void;
  readonly distinctId: string;
  readonly userState: PersistedUserState;
}) => {
  const calls: string[] = [];
  const identifyArguments: Array<
    Parameters<PostHogIdentityClient["identify"]>
  > = [];
  let distinctId = input.distinctId;
  let userState = input.userState;
  let resetCount = 0;

  const client: PostHogIdentityClient = {
    get_distinct_id() {
      calls.push("get_distinct_id");
      return distinctId;
    },
    get_property(propertyName) {
      calls.push(`get_property(${propertyName})`);
      return propertyName === "$user_state" ? userState : undefined;
    },
    identify(...arguments_) {
      identifyArguments.push(arguments_);
      calls.push("identify");
      input.beforeIdentify?.();
      const [nextDistinctId] = arguments_;
      if (nextDistinctId === undefined) {
        throw new Error("The fake only supports explicit identify IDs");
      }
      distinctId = nextDistinctId;
      userState = "identified";
    },
    opt_in_capturing(options) {
      calls.push(`opt_in(${String(options?.captureEventName)})`);
    },
    opt_out_capturing() {
      calls.push("opt_out");
    },
    reset(options) {
      calls.push(`reset(${String(options)})`);
      resetCount += 1;
      distinctId = `anonymous-after-reset-${resetCount}`;
      userState = "anonymous";
    },
  };

  return {
    calls,
    client,
    identifyArguments,
    setSdkState(
      next: Partial<{ distinctId: string; userState: PersistedUserState }>
    ) {
      if (next.distinctId !== undefined) distinctId = next.distinctId;
      if (next.userState !== undefined) userState = next.userState;
    },
    get resetCount() {
      return resetCount;
    },
  };
};

const accountId = (value: string) => customerAccountIdSchema.make(value);

describe("PostHog identity controller", () => {
  test("starts closed and pauses pending identities once without resetting persistence", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });

    expect(controller.isReady()).toBe(false);

    controller.reconcile(true, pending);
    controller.reconcile(true, unavailable);
    controller.reconcile(true, pending);

    expect(controller.isReady()).toBe(false);
    expect(lifecycle).toEqual(["pause"]);
    expect(fake.calls).toEqual([]);
    expect(fake.resetCount).toBe(0);
  });

  test("withdraws consent after pausing, clears device identity, and does so once per withdrawal", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => fake.calls.push("pause"),
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(false, pending);
    controller.reconcile(false, pending);

    expect(controller.isReady()).toBe(false);
    expect(fake.calls).toEqual(["pause", "reset(true)", "opt_out"]);
    expect(fake.resetCount).toBe(1);

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).toEqual([
      "pause",
      "reset(true)",
      "opt_out",
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
      "identify",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(controller.isReady()).toBe(true);
  });

  test("opts in anonymous persistence without resetting an already anonymous visitor", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });

    controller.reconcile(true, anonymous);

    expect(controller.isReady()).toBe(true);
    expect(fake.calls).toEqual(["get_property($user_state)", "opt_in(false)"]);
    expect(lifecycle).toEqual(["ready"]);
    expect(fake.resetCount).toBe(0);
  });

  test("resets identified persistence before opting in as anonymous", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(true, anonymous);

    expect(fake.calls).toEqual([
      "get_property($user_state)",
      "reset(true)",
      "opt_in(false)",
    ]);
    expect(fake.resetCount).toBe(1);
  });

  test("associates the initial anonymous visitor without properties", () => {
    let readyAtIdentify = false;
    let controller: ReturnType<typeof createPostHogIdentityController>;
    const fake = makeFakeClient({
      beforeIdentify: () => {
        readyAtIdentify = controller.isReady();
      },
      distinctId: "device-id",
      userState: "anonymous",
    });
    controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
      "identify",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(readyAtIdentify).toBe(true);
    expect(fake.resetCount).toBe(0);
  });

  test("resets a persisted account before switching from account A to account B", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => fake.calls.push("pause"),
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-b"))
    );

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "reset(true)",
      "opt_in(false)",
      "identify",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-b"]]);
    expect(fake.resetCount).toBe(1);
    expect(controller.isReady()).toBe(true);
  });

  test("does not identify the same account more than once", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    controller.reconcile(true, identity);

    expect(fake.identifyArguments).toEqual([]);
    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
      "get_distinct_id",
      "get_property($user_state)",
    ]);
    expect(lifecycle).toEqual(["ready"]);
  });

  test("does not trust a cached authenticated identity when SDK persistence diverges", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    fake.calls.length = 0;
    fake.setSdkState({
      distinctId: "workspace-account:account-b",
      userState: "identified",
    });

    controller.reconcile(true, identity);

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "reset(true)",
      "opt_in(false)",
      "identify",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(fake.resetCount).toBe(1);
    expect(controller.isReady()).toBe(true);
  });

  test("identifies a canonical distinct ID when the SDK persistence is not identified", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
      "identify",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(fake.resetCount).toBe(0);
  });

  test("pauses during an unresolved refresh and resumes the same account without reset or re-identify", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    fake.calls.length = 0;
    controller.reconcile(true, pending);
    controller.reconcile(true, identity);

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(fake.resetCount).toBe(0);
    expect(lifecycle).toEqual(["ready", "pause", "ready"]);
    expect(controller.isReady()).toBe(true);
  });

  test("treats a pending logout that resolves back to the same account as unchanged identity", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    fake.calls.length = 0;
    controller.reconcile(true, pending);
    controller.reconcile(true, identity);

    expect(fake.calls).toEqual([
      "get_distinct_id",
      "get_property($user_state)",
      "opt_in(false)",
    ]);
    expect(fake.identifyArguments).toEqual([]);
    expect(fake.resetCount).toBe(0);
  });

  test("resets once when an identified account becomes anonymous", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );
    fake.calls.length = 0;
    controller.reconcile(true, anonymous);
    controller.reconcile(true, anonymous);

    expect(fake.calls).toEqual([
      "get_property($user_state)",
      "reset(true)",
      "opt_in(false)",
      "get_property($user_state)",
    ]);
    expect(fake.resetCount).toBe(1);
  });

  test("resets an externally identified SDK when the cached anonymous domain remains anonymous", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(true, anonymous);
    fake.calls.length = 0;
    fake.setSdkState({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });

    controller.reconcile(true, anonymous);

    expect(fake.calls).toEqual([
      "get_property($user_state)",
      "reset(true)",
      "opt_in(false)",
    ]);
    expect(fake.resetCount).toBe(1);
    expect(controller.isReady()).toBe(true);
  });
});
