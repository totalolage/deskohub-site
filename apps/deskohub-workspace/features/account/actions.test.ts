import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AresLookupFailure } from "@deskohub/ares";
import { Context, Effect, Layer } from "effect";
import { m } from "@/features/i18n";
import { ReferralError } from "@/features/referrals/contracts";
import { CustomerAccountAccessError } from "./customer-account";

const customerEmail = testEmailAddress("ada");
const sneakyEmail = testEmailAddress("sneaky");

const revalidatePath = mock(
  (_path: string, _type?: "layout" | "page") => undefined
);
mock.module("next/cache", () => ({ revalidatePath }));

const requestHeaders = new Headers({ referer: "https://deskohub.test/en-US" });
const cookieWrites: { name: string; value: string }[] = [];
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({
    get: () => undefined,
    getAll: () => [],
    set: (name: string, value: string) => {
      cookieWrites.push({ name, value });
    },
  }),
}));
mock.module("next/server", () => ({
  after: () => undefined,
}));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));
mock.module("botid/server", () => ({
  checkBotId: () => Promise.resolve({ isBot: false }),
}));

const areAccountAvatarsEnabled = mock(() => Promise.resolve(true));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountAvatarsEnabled,
}));

let referralsEnabled = true;
const areReferralsEnabled = mock(() => Promise.resolve(referralsEnabled));
const ReferralFeatureFlag = Context.Service<
  ReferralFeatureFlag,
  { readonly isEnabled: Effect.Effect<boolean> }
>()("@test/ActionsReferralFeatureFlag");
const decideReferrals = (enabled: boolean) =>
  Layer.succeed(ReferralFeatureFlag, { isEnabled: Effect.succeed(enabled) });
Object.assign(ReferralFeatureFlag, {
  Live: Layer.succeed(ReferralFeatureFlag, {
    isEnabled: Effect.sync(() => referralsEnabled),
  }),
  fromDecision: decideReferrals,
});
mock.module("@/features/referrals/referral-feature-flag.server", () => ({
  areReferralsEnabled,
  ReferralFeatureFlagRequest: Layer.unwrap(
    Effect.promise(areReferralsEnabled).pipe(Effect.map(decideReferrals))
  ),
}));
mock.module("@/features/referrals/referral-feature-flag.service", () => ({
  ReferralFeatureFlagService: ReferralFeatureFlag,
}));

let deleteUser: (args: { body: object; headers: Headers }) => Promise<unknown>;
mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    api: {
      deleteUser: (args: { body: object; headers: Headers }) =>
        deleteUser(args),
    },
  },
}));

type Session = {
  readonly accountId: "@test/account-id";
  readonly email: string;
  readonly deletionRequested: boolean;
};

let currentUser: Effect.Effect<Session | null, unknown>;
const Authentication = Context.Service<
  Authentication,
  { readonly currentUser: Effect.Effect<Session | null, unknown> }
>()("@test/ActionsAuthentication");
Object.assign(Authentication, {
  Default: Layer.effect(
    Authentication,
    Effect.succeed({
      get currentUser() {
        return currentUser;
      },
    })
  ),
});
mock.module(
  "@/features/account/backend/customer-authentication.service",
  () => ({ CustomerAuthentication: Authentication })
);

type ProfileInput = {
  firstName: string;
  lastName?: string;
  phone?: string;
};

type Resolution =
  | {
      readonly accountId: "@test/account-id";
      readonly dotyposCustomerId: string;
    }
  | { readonly reason: string; readonly linkReason?: string };

let resolve: Effect.Effect<
  Extract<Resolution, { accountId: string }>,
  Extract<Resolution, { reason: string }>
>;
type ResolutionEffect = typeof resolve;
const Resolver = Context.Service<
  Resolver,
  { readonly resolve: ResolutionEffect }
>()("@test/ActionsResolver");
Object.assign(Resolver, {
  Live: Layer.succeed(Resolver, {
    get resolve() {
      return resolve;
    },
  }),
});
mock.module(
  "@/features/account/backend/customer-account-resolver.service",
  () => ({
    CustomerAccountResolver: Resolver,
  })
);

type SignupIntent = {
  readonly promotionCodeId: string;
  readonly referrerDotyposCustomerId: string;
};
const codeTarget: SignupIntent = {
  promotionCodeId: "@test/promotion-code-id",
  referrerDotyposCustomerId: "70001",
};
type StoredIntent = SignupIntent & {
  readonly code: string;
  readonly outcome: string | null;
  readonly acknowledged: boolean;
};
let storedIntent: StoredIntent | undefined;
const SignupIntents = Context.Service<
  SignupIntents,
  {
    readonly findCodeTarget: (
      code: string
    ) => Effect.Effect<SignupIntent | undefined>;
    readonly find: (
      accountId: string
    ) => Effect.Effect<StoredIntent | undefined>;
    readonly settle: (
      accountId: string,
      promotionCodeId: string,
      outcome: string
    ) => Effect.Effect<boolean>;
    readonly findAttributedCode: (
      customerId: string
    ) => Effect.Effect<string | undefined>;
    readonly acknowledge: (accountId: string) => Effect.Effect<void>;
  }
>()("@test/ActionsSignupIntents");
Object.assign(SignupIntents, {
  Live: Layer.succeed(SignupIntents, {
    findCodeTarget: () => Effect.succeed(codeTarget),
    find: () => Effect.sync(() => storedIntent),
    settle: (_accountId, _promotionCodeId, outcome) =>
      Effect.sync(() => {
        if (!storedIntent || storedIntent.outcome !== null) return false;
        storedIntent = { ...storedIntent, outcome };
        return true;
      }),
    findAttributedCode: () => Effect.succeed(undefined),
    acknowledge: () =>
      Effect.sync(() => {
        if (storedIntent)
          storedIntent = { ...storedIntent, acknowledged: true };
      }),
  }),
});
// The real account link repository, which the locale preference action loads,
// imports the intent insert; only the service is replaced.
const realSignupIntentModule = await import(
  "@/features/referrals/signup-intent.repository"
);
mock.module("@/features/referrals/signup-intent.repository", () => ({
  ...realSignupIntentModule,
  ReferralSignupIntentRepository: SignupIntents,
}));

const profileCalls: { op: string; args: unknown[] }[] = [];
const Profile = Context.Service<
  Profile,
  {
    readonly update: (
      account: { accountId: string; dotyposCustomerId: string },
      input: ProfileInput
    ) => Effect.Effect<{ firstName: string }, never>;
    readonly create: (
      accountId: string,
      email: string,
      input: ProfileInput,
      signupReferral?: SignupIntent
    ) => Effect.Effect<
      {
        readonly account: { accountId: string; dotyposCustomerId: string };
        readonly profile: { firstName: string };
        readonly created: boolean;
      },
      never
    >;
  }
>()("@test/ActionsProfile");
Object.assign(Profile, {
  Live: Layer.succeed(Profile, {
    update: (account, input) => {
      profileCalls.push({ op: "update", args: [account, input] });
      return Effect.succeed({ firstName: "Ada" });
    },
    create: (accountId, email, input, signupReferral) => {
      profileCalls.push({
        op: "create",
        args: [accountId, email, input, signupReferral],
      });
      // The real link repository stores the intent with the created link.
      storedIntent = signupReferral && {
        ...signupReferral,
        code: "RFL12345",
        outcome: null,
        acknowledged: false,
      };
      return Effect.succeed({
        account: { accountId, dotyposCustomerId: "60222" },
        profile: { firstName: "Ada" },
        created: true,
      });
    },
  }),
});
mock.module("@/features/account/backend/customer-profile.service", () => ({
  CustomerProfileService: Profile,
}));

type ReferralIdentity = {
  readonly code: unknown;
  readonly customerAccountId: string;
  readonly dotyposCustomerId: string;
};
const referralCalls: { op: string; args: unknown }[] = [];
let availableReferralCode: Effect.Effect<string | undefined, ReferralError>;
let referralAcceptance: Effect.Effect<
  { readonly kind: "accepted" },
  ReferralError
>;
let settledReferral: Effect.Effect<boolean, ReferralError>;
const Referrals = Context.Service<
  Referrals,
  {
    readonly findAvailableCode: (input: {
      readonly code: unknown;
    }) => Effect.Effect<string | undefined, ReferralError>;
    readonly acceptReferral: (
      input: ReferralIdentity
    ) => Effect.Effect<{ readonly kind: "accepted" }, ReferralError>;
    readonly hasSettledReferral: (input: {
      readonly dotyposCustomerId: string;
    }) => Effect.Effect<boolean, ReferralError>;
  }
>()("@test/ActionsReferrals");
Object.assign(Referrals, {
  Live: Layer.succeed(Referrals, {
    findAvailableCode: (input) => {
      referralCalls.push({ op: "findAvailableCode", args: input });
      return availableReferralCode;
    },
    acceptReferral: (input) => {
      referralCalls.push({ op: "acceptReferral", args: input });
      return referralAcceptance;
    },
    hasSettledReferral: (input) => {
      referralCalls.push({ op: "hasSettledReferral", args: input });
      return settledReferral;
    },
  }),
});
mock.module("@/features/referrals", () => ({ ReferralService: Referrals }));

let rememberedReferralCode: string | undefined;
const forgetRememberedReferralCode = mock(async () => undefined);
mock.module("@/features/referrals/remembered-referral-code.server", () => ({
  // Like the real reader: the request's provided decision, then the cookie.
  readRememberedReferralCode: ReferralFeatureFlag.pipe(
    Effect.flatMap((featureFlag) => featureFlag.isEnabled),
    Effect.flatMap((released) =>
      released
        ? Effect.promise(async () => {
            const { parseReferralCode } = await import(
              "@/features/referrals/client"
            );
            return parseReferralCode(rememberedReferralCode);
          })
        : Effect.undefined
    )
  ),
  forgetRememberedReferralCode,
}));

type PreferenceSave = {
  readonly accountId: "@test/account-id";
  readonly locale: "cs-CZ" | "en-US";
};

let preferenceSaveEffect: Effect.Effect<void, unknown> =
  Effect.succeed(undefined);
let preferenceSaveCalls: PreferenceSave[] = [];

mock.module("@/features/account/backend/customer-locale-preference", () => ({
  saveAccountLocalePreference: (accountId: string, locale: string) => {
    preferenceSaveCalls.push({
      accountId: accountId as "@test/account-id",
      locale: locale as "cs-CZ" | "en-US",
    });
    return preferenceSaveEffect;
  },
}));

let lookupOutcome: Effect.Effect<
  typeof syntheticAresCompany,
  AresLookupFailure
>;
let lookupCalls: string[];
const AresLookup = Context.Service<
  AresLookup,
  {
    readonly lookup: (
      ico: string
    ) => Effect.Effect<typeof syntheticAresCompany, AresLookupFailure>;
  }
>()("@test/ActionsAresLookup");
Object.assign(AresLookup, {
  Live: Layer.succeed(AresLookup, {
    lookup: (ico: string) => {
      lookupCalls.push(ico);
      return lookupOutcome;
    },
  }),
});
mock.module("@deskohub/ares", () => ({
  AresLookupFailure,
  AresLookupService: AresLookup,
}));

const syntheticAresCompany = {
  ico: "27082440",
  obchodniJmeno: "Synthetická testovací s.r.o.",
  dic: "CZ27082440",
  sidlo: {
    nazevUlice: "Testovací ulice",
    cisloDomovni: 123,
    cisloOrientacni: 4,
    nazevObce: "Praha",
    psc: 11000,
    kodStatu: "CZ",
  },
};

const activeSession = {
  accountId: "@test/account-id" as const,
  email: customerEmail,
  deletionRequested: false,
};

describe("account actions", () => {
  beforeEach(() => {
    profileCalls.length = 0;
    referralCalls.length = 0;
    storedIntent = undefined;
    availableReferralCode = Effect.succeed("RFL12345");
    referralAcceptance = Effect.succeed({ kind: "accepted" });
    settledReferral = Effect.succeed(false);
    rememberedReferralCode = undefined;
    forgetRememberedReferralCode.mockClear();
    revalidatePath.mockClear();
    referralsEnabled = true;
    areReferralsEnabled.mockReset();
    areReferralsEnabled.mockImplementation(() =>
      Promise.resolve(referralsEnabled)
    );
    currentUser = Effect.succeed(activeSession);
    resolve = Effect.succeed({
      accountId: "@test/account-id",
      dotyposCustomerId: "60111",
    });
    deleteUser = () => Promise.resolve({ success: true });
    preferenceSaveEffect = Effect.succeed(undefined);
    preferenceSaveCalls = [];
    cookieWrites.length = 0;
  });

  const importActions = () => import("./actions");

  test("creates the profile from the verified session when no profile matches", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "not-found",
      })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({ firstName: "Ada" });

    expect(result).toEqual({ data: { status: "completed" } });
    expect(profileCalls.map(({ op }) => op)).toEqual(["create"]);
    expect(profileCalls[0]!.args).toEqual([
      "@test/account-id",
      customerEmail,
      { firstName: "Ada" },
      undefined,
    ]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  const resolveAsNewCustomerUntilCreated = () => {
    resolve = Effect.suspend(() =>
      profileCalls.some(({ op }) => op === "create")
        ? Effect.succeed({
            accountId: "@test/account-id" as const,
            dotyposCustomerId: "60222",
          })
        : Effect.fail(
            new CustomerAccountAccessError({
              reason: "link-required",
              linkReason: "not-found",
            })
          )
    );
  };

  test("stores the entered referral with the new link and records it afterwards", async () => {
    resolveAsNewCustomerUntilCreated();
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: " rfl12345 ",
    });

    expect(result).toEqual({
      data: { status: "completed", referral: { status: "applied" } },
    });
    expect(profileCalls).toEqual([
      {
        op: "create",
        args: [
          "@test/account-id",
          customerEmail,
          { firstName: "Ada" },
          codeTarget,
        ],
      },
    ]);
    expect(referralCalls).toEqual([
      { op: "findAvailableCode", args: { code: "rfl12345" } },
      {
        op: "acceptReferral",
        args: {
          code: "RFL12345",
          customerAccountId: "@test/account-id",
          dotyposCustomerId: "60222",
        },
      },
    ]);
    expect(storedIntent?.outcome).toBe("applied");
  });

  test("reports an unavailable typed referral code on its field and creates nothing", async () => {
    resolveAsNewCustomerUntilCreated();
    availableReferralCode = Effect.succeed(undefined);
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFLGONE1",
      prefilledReferralCode: "RFL12345",
    });

    expect(result).toEqual({
      data: { status: "referral-code-unavailable" },
    });
    expect(profileCalls).toEqual([]);
    expect(referralCalls.map(({ op }) => op)).toEqual(["findAvailableCode"]);
  });

  test("completes without a referral when the shared-link code cannot be checked", async () => {
    resolveAsNewCustomerUntilCreated();
    availableReferralCode = Effect.fail(
      new ReferralError({ reason: "unavailable" })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "rfl12345",
      prefilledReferralCode: "RFL12345",
    });

    expect(result).toEqual({ data: { status: "completed" } });
    expect(profileCalls.map(({ args }) => args[3])).toEqual([undefined]);
    expect(referralCalls.map(({ op }) => op)).toEqual(["findAvailableCode"]);
  });

  test("reports the referral as not applied when the account already has one", async () => {
    resolveAsNewCustomerUntilCreated();
    referralAcceptance = Effect.fail(
      new ReferralError({ reason: "already_attributed" })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
    });

    expect(result).toEqual({
      data: {
        status: "completed",
        referral: { status: "not-applied", reason: "already-referred" },
      },
    });
    expect(referralCalls.map(({ op }) => op)).toEqual([
      "findAvailableCode",
      "acceptReferral",
    ]);
    expect(storedIntent?.outcome).toBe("already-referred");
  });

  test("records a typed referral code instead of the remembered one", async () => {
    resolveAsNewCustomerUntilCreated();
    rememberedReferralCode = "RFLCOOKIE";
    const { completeCustomerProfile } = await importActions();

    await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFLTYPED1",
      prefilledReferralCode: "RFLCOOKIE",
    });

    expect(referralCalls[0]).toEqual({
      op: "findAvailableCode",
      args: { code: "RFLTYPED1" },
    });
  });

  test("forgets the remembered code once completion leaves the customer's referral settled", async () => {
    resolveAsNewCustomerUntilCreated();
    rememberedReferralCode = "RFL12345";
    settledReferral = Effect.succeed(true);
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
      prefilledReferralCode: "RFL12345",
    });

    expect(result).toEqual({
      data: { status: "completed", referral: { status: "applied" } },
    });
    expect(referralCalls.at(-1)).toEqual({
      op: "hasSettledReferral",
      args: { dotyposCustomerId: "60222" },
    });
    expect(forgetRememberedReferralCode).toHaveBeenCalledTimes(1);
  });

  test("decides the referral program once per action, so a later flag outage cannot skip its referral work", async () => {
    resolveAsNewCustomerUntilCreated();
    rememberedReferralCode = "RFL12345";
    settledReferral = Effect.succeed(true);
    // The first evaluation succeeds; any later one would fail closed.
    areReferralsEnabled
      .mockImplementationOnce(() => Promise.resolve(true))
      .mockImplementation(() => Promise.resolve(false));
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
      prefilledReferralCode: "RFL12345",
    });

    expect(areReferralsEnabled).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      data: { status: "completed", referral: { status: "applied" } },
    });
    // The remembered-code reader used the same decision as the completion.
    expect(forgetRememberedReferralCode).toHaveBeenCalledTimes(1);
  });

  test("keeps the remembered code while the customer's referral is open or unknown", async () => {
    resolveAsNewCustomerUntilCreated();
    rememberedReferralCode = "RFL12345";
    referralAcceptance = Effect.fail(
      new ReferralError({ reason: "pending_payment" })
    );
    const { completeCustomerProfile } = await importActions();

    const pending = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
      prefilledReferralCode: "RFL12345",
    });
    expect(pending).toEqual({
      data: { status: "completed", referral: { status: "pending" } },
    });

    settledReferral = Effect.fail(new ReferralError({ reason: "unavailable" }));
    const unknown = await completeCustomerProfile({ firstName: "Ada" });
    expect(unknown).toEqual({ data: { status: "completed" } });

    expect(
      referralCalls.filter(({ op }) => op === "hasSettledReferral")
    ).toHaveLength(2);
    expect(forgetRememberedReferralCode).not.toHaveBeenCalled();
  });

  test("never checks whether the referral is settled without a remembered code", async () => {
    resolveAsNewCustomerUntilCreated();
    settledReferral = Effect.succeed(true);
    const { completeCustomerProfile } = await importActions();

    await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
    });

    expect(referralCalls.map(({ op }) => op)).toEqual([
      "findAvailableCode",
      "acceptReferral",
    ]);
    expect(forgetRememberedReferralCode).not.toHaveBeenCalled();
  });

  test("ignores a referral code when completion finds an already linked customer", async () => {
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFL12345",
    });

    expect(result).toEqual({ data: { status: "completed" } });
    expect(profileCalls).toEqual([
      {
        op: "update",
        args: [
          { accountId: "@test/account-id", dotyposCustomerId: "60111" },
          { firstName: "Ada" },
        ],
      },
    ]);
    expect(referralCalls).toEqual([]);
  });

  test("updates the profile when the account already links a customer", async () => {
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Grace" });

    expect(result).toEqual({ data: { status: "updated" } });
    expect(profileCalls.map(({ op }) => op)).toEqual(["update"]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("rejects an email in the profile input and never forwards profile fields containing one", async () => {
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({
      firstName: "Ada",
      email: sneakyEmail,
    } as never);

    expect(result.validationErrors).toBeTruthy();
    expect(profileCalls).toHaveLength(0);
    expect(JSON.stringify(profileCalls)).not.toContain(sneakyEmail);
  });

  test("returns the localized profile error when the resolver blocks the edit", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    const { updateCustomerProfile } = await importActions();

    const result = await updateCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(profileCalls).toHaveLength(0);
  });

  test("never creates or updates a profile when resolution reports an unusable exact-email profile", async () => {
    resolve = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "unusable",
      })
    );
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({ firstName: "Ada" });

    expect(result.serverError).toBeTruthy();
    expect(profileCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  // A cookie write makes Next re-render the referring page under its old
  // locale in the save's response while the locale switch navigates away
  // from it; the error page flashed in that window. The proxy moves the
  // locale cookie on the navigated page.
  test("leaves the locale cookie to the proxy", async () => {
    const { updateLocalePreference } = await importActions();

    await updateLocalePreference({ locale: "cs-CZ" });

    expect(preferenceSaveCalls).toHaveLength(1);
    expect(cookieWrites).toEqual([]);
  });

  test("ignores a submitted referral code while the referral program is withheld", async () => {
    referralsEnabled = false;
    resolveAsNewCustomerUntilCreated();
    availableReferralCode = Effect.succeed(undefined);
    rememberedReferralCode = "RFL12345";
    settledReferral = Effect.succeed(true);
    const { completeCustomerProfile } = await importActions();

    const result = await completeCustomerProfile({
      firstName: "Ada",
      referralCode: "RFLGONE1",
      prefilledReferralCode: "RFL12345",
    });

    expect(result).toEqual({ data: { status: "completed" } });
    expect(profileCalls).toEqual([
      {
        op: "create",
        args: [
          "@test/account-id",
          customerEmail,
          { firstName: "Ada" },
          undefined,
        ],
      },
    ]);
    expect(storedIntent).toBeUndefined();
    expect(referralCalls).toEqual([]);
    expect(forgetRememberedReferralCode).not.toHaveBeenCalled();
  });

  test("acknowledges the settled signup referral notice", async () => {
    storedIntent = {
      ...codeTarget,
      code: "RFL12345",
      outcome: "applied",
      acknowledged: false,
    };
    const { acknowledgeSignupReferralNotice } = await importActions();

    const result = await acknowledgeSignupReferralNotice({});

    expect(result).toEqual({ data: { status: "acknowledged" } });
    expect(storedIntent?.acknowledged).toBe(true);
  });

  test("leaves the signup referral notice untouched while the referral program is withheld", async () => {
    referralsEnabled = false;
    storedIntent = {
      ...codeTarget,
      code: "RFL12345",
      outcome: "applied",
      acknowledged: false,
    };
    const { acknowledgeSignupReferralNotice } = await importActions();

    const result = await acknowledgeSignupReferralNotice({});

    expect(result.serverError).toBe(
      m.accountUnavailableDescription({}, { locale: "en-US" })
    );
    expect(areReferralsEnabled).toHaveBeenCalledTimes(1);
    expect(storedIntent?.acknowledged).toBe(false);
  });

  test("saves the locale preference for the verified account", async () => {
    const { updateLocalePreference } = await importActions();

    const result = await updateLocalePreference({ locale: "cs-CZ" });

    expect(result).toEqual({ data: { status: "saved" } });
    expect(preferenceSaveCalls).toEqual([
      { accountId: "@test/account-id", locale: "cs-CZ" },
    ]);
    expect(profileCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("returns the session-expired error without saving when unauthenticated", async () => {
    currentUser = Effect.succeed(null);
    const { updateLocalePreference } = await importActions();

    const result = await updateLocalePreference({ locale: "cs-CZ" });

    expect(result.serverError).toBe(
      m.accountSessionExpired({}, { locale: "en-US" })
    );
    expect(preferenceSaveCalls).toHaveLength(0);
  });

  test("returns the deletion-pending error when the account is being deleted", async () => {
    preferenceSaveEffect = Effect.fail(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    const { updateLocalePreference } = await importActions();

    const result = await updateLocalePreference({ locale: "en-US" });

    expect(result.serverError).toBe(
      m.accountDeletionPendingError({}, { locale: "en-US" })
    );
    expect(preferenceSaveCalls).toHaveLength(1);
    expect(cookieWrites).toEqual([]);
  });

  test("deletes through the Better Auth endpoint and revalidates every account path", async () => {
    const seen: { body: object; headers: Headers }[] = [];
    deleteUser = async (args) => {
      seen.push(args);
      return { success: true };
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "deleted" } });
    expect(seen).toHaveLength(1);
    expect(String(seen[0]!.headers.get("referer"))).toContain("deskohub.test");
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account", "layout");
  });

  test("asks for reauthentication when the delete endpoint reports a stale session", async () => {
    const { APIError } = await import("better-auth");
    deleteUser = () => {
      throw new APIError("BAD_REQUEST", {
        message: "Session expired. Re-authenticate to perform this action.",
        code: "SESSION_EXPIRED",
      });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "reauthentication-required" } });
  });

  test("asks for reauthentication when the session is already gone", async () => {
    currentUser = Effect.succeed(null);

    let deleteUserCalls = 0;
    deleteUser = () => {
      deleteUserCalls += 1;
      return Promise.resolve({ success: true });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "reauthentication-required" } });
    expect(deleteUserCalls).toBe(0);
  });

  test("reports a retryable failure when the session cannot be read", async () => {
    const { customerAccountUnavailable } = await import("./customer-account");
    currentUser = Effect.fail(
      customerAccountUnavailable("authentication.session")
    );

    let deleteUserCalls = 0;
    deleteUser = () => {
      deleteUserCalls += 1;
      return Promise.resolve({ success: true });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "failed" } });
    expect(deleteUserCalls).toBe(0);
  });

  test("reports a retryable failure for other endpoint errors and keeps the account", async () => {
    const { APIError } = await import("better-auth");
    deleteUser = () => {
      throw new APIError("INTERNAL_SERVER_ERROR", {
        message: "beforeDelete failed",
      });
    };
    const { deleteCustomerAccount } = await importActions();

    const result = await deleteCustomerAccount({ confirmed: true });

    expect(result).toEqual({ data: { status: "failed" } });
    expect(revalidatePath).toHaveBeenCalledWith("/en-US/account", "layout");
  });
});

describe("account ARES business lookup action", () => {
  beforeEach(() => {
    profileCalls.length = 0;
    revalidatePath.mockClear();
    currentUser = Effect.succeed(activeSession);
    resolve = Effect.succeed({
      accountId: "@test/account-id",
      dotyposCustomerId: "60111",
    });
    lookupCalls = [];
    lookupOutcome = Effect.succeed(syntheticAresCompany);
  });

  const importActions = () => import("./actions");

  test("returns the mapped billing draft for a found company with one provider call", async () => {
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: " 27082440 " });

    expect(result).toEqual({
      data: {
        status: "found",
        company: {
          companyName: "Synthetická testovací s.r.o.",
          companyId: "27082440",
          vatId: "CZ27082440",
          addressLine1: "Testovací ulice 123/4",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      },
    });
    expect(lookupCalls).toEqual(["27082440"]);
    expect(profileCalls).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("reports an unavailable registry as retryable", async () => {
    lookupOutcome = Effect.fail(
      new AresLookupFailure({ reason: "Unavailable" })
    );
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result).toEqual({
      data: {
        status: "unavailable",
        message:
          "The business registry is temporarily unavailable. Please try again in a moment.",
      },
    });
  });

  test("never looks up a company without a verified session", async () => {
    currentUser = Effect.succeed(null);
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result.serverError).toBe(
      "Your session has expired. Please sign in again."
    );
    expect(lookupCalls).toHaveLength(0);
  });

  test("succeeds for a verified unlinked account without resolving the customer", async () => {
    let resolverRuns = 0;
    resolve = Effect.suspend(() => {
      resolverRuns += 1;
      return Effect.fail(
        new CustomerAccountAccessError({
          reason: "link-required",
          linkReason: "not-found",
        })
      );
    });
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result).toEqual({
      data: {
        status: "found",
        company: {
          companyName: "Synthetická testovací s.r.o.",
          companyId: "27082440",
          vatId: "CZ27082440",
          addressLine1: "Testovací ulice 123/4",
          city: "Praha",
          zip: "11000",
          country: "CZ",
        },
      },
    });
    expect(lookupCalls).toEqual(["27082440"]);
    // The read-only lookup must not run any resolver-owned write seam:
    // no resolution (which can reactivate and claim), no profile
    // classification, create, update, or patch.
    expect(resolverRuns).toBe(0);
    expect(profileCalls).toHaveLength(0);
  });

  test("never looks up a company while deletion is pending", async () => {
    currentUser = Effect.succeed({
      ...activeSession,
      deletionRequested: true,
    });
    const { lookupAresBusiness } = await importActions();

    const result = await lookupAresBusiness({ ico: "27082440" });

    expect(result.serverError).toBe(
      "Your account is already being deleted, so the profile cannot be changed."
    );
    expect(lookupCalls).toHaveLength(0);
    expect(profileCalls).toHaveLength(0);
  });
});
