import { describe, expect, test } from "bun:test";
import {
  type DotyposCustomerId,
  DotyposCustomerIdSchema,
} from "@deskohub/dotypos/types";
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
  accountId?: CustomerAccountId,
  testAccount = false
): AnalyticsAccountIdentity => {
  if (status === "authenticated") {
    if (!accountId)
      throw new Error("An authenticated identity needs an account ID");
    return { accountId, status, testAccount };
  }

  return { status };
};

const pending = makeIdentity("pending");
const unavailable = makeIdentity("unavailable");
const anonymous = makeIdentity("anonymous");

const makeFakeClient = (input: {
  /** Runs once the SDK switched identity, as when it emits $identify. */
  readonly duringIdentify?: () => void;
  readonly distinctId: string;
  readonly userState: PersistedUserState;
}) => {
  // Records only state-changing SDK calls; read-only probes are free to change.
  const calls: string[] = [];
  const identifyArguments: Array<
    Parameters<PostHogIdentityClient["identify"]>
  > = [];
  let distinctId = input.distinctId;
  let userState = input.userState;
  let resetCount = 0;

  const client: PostHogIdentityClient = {
    get_distinct_id() {
      return distinctId;
    },
    get_property(propertyName) {
      return propertyName === "$user_state" ? userState : undefined;
    },
    identify(...arguments_) {
      identifyArguments.push(arguments_);
      calls.push("identify");
      const [nextDistinctId] = arguments_;
      if (nextDistinctId === undefined) {
        throw new Error("The fake only supports explicit identify IDs");
      }
      distinctId = nextDistinctId;
      userState = "identified";
      input.duringIdentify?.();
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
    setInternalOrTestUser() {
      calls.push("set_internal_or_test_user");
    },
    setPersonProperties(properties) {
      calls.push(`set_person_properties(${JSON.stringify(properties)})`);
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
const accountA = makeIdentity("authenticated", accountId("account-a"));

const setDotyposCustomer = (dotyposCustomerId: string) =>
  `set_person_properties(${JSON.stringify({ dotypos_customer_id: dotyposCustomerId })})`;

/** A link store keyed by account, like the browser's customer link cache. */
const makeCustomerLinks = (initial: Record<string, string> = {}) => {
  const links = new Map<string, DotyposCustomerId>(
    Object.entries(initial).map(([account, dotyposCustomerId]) => [
      account,
      DotyposCustomerIdSchema.make(dotyposCustomerId),
    ])
  );
  return {
    link(account: CustomerAccountId, dotyposCustomerId: string) {
      links.set(account, DotyposCustomerIdSchema.make(dotyposCustomerId));
    },
    read: (account: CustomerAccountId) => links.get(account),
  };
};

describe("PostHog identity controller", () => {
  test("starts closed and pauses pending identities once without resetting persistence", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });

    expect(controller.isReadyFor(accountA)).toBe(false);

    controller.reconcile(true, pending);
    controller.reconcile(true, unavailable);
    controller.reconcile(true, pending);

    expect(controller.isReadyFor(accountA)).toBe(false);
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
      deploymentEnvironment: "production",
      onPause: () => fake.calls.push("pause"),
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(false, pending);
    controller.reconcile(false, pending);

    expect(controller.isReadyFor(accountA)).toBe(false);
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
      "opt_in(false)",
      "identify",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(controller.isReadyFor(accountA)).toBe(true);
  });

  test("opts in anonymous persistence without resetting an already anonymous visitor", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });

    controller.reconcile(true, anonymous);

    expect(controller.isReadyFor(anonymous)).toBe(true);
    expect(fake.calls).toEqual(["opt_in(false)"]);
    expect(lifecycle).toEqual(["ready"]);
    expect(fake.resetCount).toBe(0);
  });

  test("associates the initial anonymous visitor without properties", () => {
    let readyAtIdentify = false;
    let controller: ReturnType<typeof createPostHogIdentityController>;
    const fake = makeFakeClient({
      duringIdentify: () => {
        readyAtIdentify = controller.isReadyFor(accountA);
      },
      distinctId: "device-id",
      userState: "anonymous",
    });
    controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).toEqual(["opt_in(false)", "identify", "ready"]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(readyAtIdentify).toBe(true);
    expect(fake.resetCount).toBe(0);
  });

  test("marks a test account as an internal or test user after identifying it", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"), true)
    );

    expect(fake.calls).toEqual([
      "opt_in(false)",
      "identify",
      "set_internal_or_test_user",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
  });

  test("marks a test account restored from an identified browser without identifying again", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => fake.calls.push("ready"),
    });
    const identity = makeIdentity(
      "authenticated",
      accountId("account-a"),
      true
    );

    controller.reconcile(true, identity);
    controller.reconcile(true, identity);

    expect(fake.identifyArguments).toEqual([]);
    expect(fake.calls).toEqual([
      "opt_in(false)",
      "set_internal_or_test_user",
      "ready",
    ]);
  });

  test("never marks an ordinary production account or an anonymous visitor as a test user", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(true, anonymous);
    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).not.toContain("set_internal_or_test_user");
  });

  for (const deploymentEnvironment of ["preview", "development"] as const) {
    test(`marks an ordinary ${deploymentEnvironment} account as an internal or test user`, () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment,
        onPause: () => undefined,
        onReady: () => fake.calls.push("ready"),
      });

      controller.reconcile(true, anonymous);
      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-a"))
      );

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "ready",
        "opt_in(false)",
        "identify",
        "set_internal_or_test_user",
        "ready",
      ]);
    });
  }

  test("resets a persisted account before switching from account A to account B", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => fake.calls.push("pause"),
      onReady: () => fake.calls.push("ready"),
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-b"))
    );

    expect(fake.calls).toEqual([
      "reset(true)",
      "opt_in(false)",
      "identify",
      "ready",
    ]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-b"]]);
    expect(fake.resetCount).toBe(1);
    expect(
      controller.isReadyFor(
        makeIdentity("authenticated", accountId("account-b"))
      )
    ).toBe(true);
  });

  test("does not identify the same account more than once", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const lifecycle: string[] = [];
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    controller.reconcile(true, identity);

    expect(fake.identifyArguments).toEqual([]);
    expect(fake.calls).toEqual(["opt_in(false)"]);
    expect(lifecycle).toEqual(["ready"]);
  });

  test("does not trust a cached authenticated identity when SDK persistence diverges", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
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

    expect(fake.calls).toEqual(["reset(true)", "opt_in(false)", "identify"]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(fake.resetCount).toBe(1);
    expect(controller.isReadyFor(identity)).toBe(true);
  });

  test("identifies a canonical distinct ID when the SDK persistence is not identified", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(
      true,
      makeIdentity("authenticated", accountId("account-a"))
    );

    expect(fake.calls).toEqual(["opt_in(false)", "identify"]);
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
      deploymentEnvironment: "production",
      onPause: () => lifecycle.push("pause"),
      onReady: () => lifecycle.push("ready"),
    });
    const identity = makeIdentity("authenticated", accountId("account-a"));

    controller.reconcile(true, identity);
    fake.calls.length = 0;
    controller.reconcile(true, pending);
    controller.reconcile(true, identity);

    expect(fake.calls).toEqual(["opt_in(false)"]);
    expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    expect(fake.resetCount).toBe(0);
    expect(lifecycle).toEqual(["ready", "pause", "ready"]);
    expect(controller.isReadyFor(identity)).toBe(true);
  });

  test("resets once when an identified account becomes anonymous", () => {
    const fake = makeFakeClient({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
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

    expect(fake.calls).toEqual(["reset(true)", "opt_in(false)"]);
    expect(fake.resetCount).toBe(1);
  });

  test("resets an externally identified SDK when the cached anonymous domain remains anonymous", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
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

    expect(fake.calls).toEqual(["reset(true)", "opt_in(false)"]);
    expect(fake.resetCount).toBe(1);
    expect(controller.isReadyFor(anonymous)).toBe(true);
  });

  test("is ready only for the settled identity while the SDK still holds it", () => {
    const fake = makeFakeClient({
      distinctId: "device-id",
      userState: "anonymous",
    });
    const controller = createPostHogIdentityController(fake.client, {
      deploymentEnvironment: "production",
      onPause: () => undefined,
      onReady: () => undefined,
    });

    controller.reconcile(true, accountA);

    expect(controller.isReadyFor(accountA)).toBe(true);
    expect(
      controller.isReadyFor(
        makeIdentity("authenticated", accountId("account-a"), true)
      )
    ).toBe(true);
    expect(
      controller.isReadyFor(
        makeIdentity("authenticated", accountId("account-b"))
      )
    ).toBe(false);
    expect(controller.isReadyFor(anonymous)).toBe(false);
    expect(controller.isReadyFor(pending)).toBe(false);

    fake.setSdkState({ userState: "anonymous" });
    expect(controller.isReadyFor(accountA)).toBe(false);

    controller.reconcile(false, accountA);
    fake.setSdkState({
      distinctId: "workspace-account:account-a",
      userState: "identified",
    });
    expect(controller.isReadyFor(accountA)).toBe(false);
  });

  describe("Dotypos customer person property", () => {
    test("sets the customer ID right after identifying a linked account", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const links = makeCustomerLinks({ "account-a": "customer-a" });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => fake.calls.push("ready"),
        readDotyposCustomerId: links.read,
      });

      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-a"))
      );

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-a"),
        "ready",
      ]);
      expect(fake.identifyArguments).toEqual([["workspace-account:account-a"]]);
    });

    test("sets the customer ID on a restored session without identifying again", () => {
      const fake = makeFakeClient({
        distinctId: "workspace-account:account-a",
        userState: "identified",
      });
      const links = makeCustomerLinks({ "account-a": "customer-a" });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: links.read,
      });
      const identity = makeIdentity("authenticated", accountId("account-a"));

      controller.reconcile(true, identity);
      controller.reconcile(true, pending);
      controller.reconcile(true, identity);

      expect(fake.identifyArguments).toEqual([]);
      expect(fake.calls).toEqual([
        "opt_in(false)",
        setDotyposCustomer("customer-a"),
        "opt_in(false)",
      ]);
    });

    test("sets a customer link that loads after identify once", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const links = makeCustomerLinks();
      const lifecycle: string[] = [];
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => lifecycle.push("pause"),
        onReady: () => lifecycle.push("ready"),
        readDotyposCustomerId: links.read,
      });
      const identity = makeIdentity("authenticated", accountId("account-a"));

      controller.reconcile(true, identity);
      links.link(accountId("account-a"), "customer-late");
      controller.reconcile(true, identity);
      controller.reconcile(true, identity);

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-late"),
      ]);
      expect(lifecycle).toEqual(["ready"]);
    });

    test("sends nothing for an account without a Dotypos customer", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: makeCustomerLinks().read,
      });

      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-a"))
      );
      controller.reconcile(true, anonymous);

      expect(
        fake.calls.filter((call) => call.startsWith("set_person_properties"))
      ).toEqual([]);
    });

    test("keeps test-account tagging beside the customer ID", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: makeCustomerLinks({ "account-a": "customer-a" })
          .read,
      });

      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-a"), true)
      );

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "identify",
        "set_internal_or_test_user",
        setDotyposCustomer("customer-a"),
      ]);
    });

    test("sets each account's own customer ID after an account switch", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: makeCustomerLinks({
          "account-a": "customer-a",
          "account-b": "customer-b",
        }).read,
      });

      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-a"))
      );
      controller.reconcile(true, pending);
      controller.reconcile(
        true,
        makeIdentity("authenticated", accountId("account-b"))
      );

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-a"),
        "reset(true)",
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-b"),
      ]);
    });

    test("sets the customer ID again after consent is withdrawn and given back", () => {
      const fake = makeFakeClient({
        distinctId: "device-id",
        userState: "anonymous",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: makeCustomerLinks({ "account-a": "customer-a" })
          .read,
      });
      const identity = makeIdentity("authenticated", accountId("account-a"));

      controller.reconcile(true, identity);
      controller.reconcile(false, identity);
      controller.reconcile(true, identity);

      expect(fake.calls).toEqual([
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-a"),
        "reset(true)",
        "opt_out",
        "opt_in(false)",
        "identify",
        setDotyposCustomer("customer-a"),
      ]);
    });

    test("never sets the customer ID without analytics consent", () => {
      const fake = makeFakeClient({
        distinctId: "workspace-account:account-a",
        userState: "identified",
      });
      const controller = createPostHogIdentityController(fake.client, {
        deploymentEnvironment: "production",
        onPause: () => undefined,
        onReady: () => undefined,
        readDotyposCustomerId: makeCustomerLinks({ "account-a": "customer-a" })
          .read,
      });

      controller.reconcile(
        false,
        makeIdentity("authenticated", accountId("account-a"))
      );

      expect(fake.calls).toEqual(["reset(true)", "opt_out"]);
    });
  });
});
