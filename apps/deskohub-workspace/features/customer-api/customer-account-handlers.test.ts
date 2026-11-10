import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { customerReferralCodeHeader } from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import {
  AccountAvatarReleaseGate,
  PasskeyReleaseGate,
} from "@/features/account/backend/account-release-gates";
import { CustomerAgentConnections } from "@/features/account/backend/auth/customer-agent-connections.service";
import { CustomerPasskeys } from "@/features/account/backend/auth/customer-passkeys.service";
import {
  CustomerAccountDeletionEndpoint,
  type CustomerAccountDeletionEndpointResult,
} from "@/features/account/backend/auth/delete-account-endpoint";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import {
  CustomerAvatarProviderError,
  CustomerAvatarService,
} from "@/features/account/backend/customer-avatar.service";
import { CustomerLocalePreference } from "@/features/account/backend/customer-locale-preference.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import type {
  CustomerProfileInput,
  CustomerProfileSave,
} from "@/features/account/contracts";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
  type LinkedCustomerAccount,
} from "@/features/account/customer-account";
import {
  MarketingConsentLedger,
  type MarketingConsentRecord,
  MarketingConsentUnavailable,
} from "@/features/legal/backend/marketing-consent-ledger";
import { MarketingPreferences } from "@/features/legal/backend/marketing-preferences.service";
import { getAccountMarketingManagementContext } from "@/features/legal/backend/marketing-preferences-authority";
import type { MarketingConsentStatus } from "@/features/legal/marketing-consent-status";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralSignupIntentRepository } from "@/features/referrals/signup-intent.repository";
import type { CustomerAccountServiceLayers } from "./customer-account-layers";
import {
  accountReleasesOver,
  answerInEachReleaseCohort,
  type CustomerApiCall,
  customerApiRequest,
  expectEachCohortAnsweredAlone,
  inReleaseCohort,
  linkedAccountServices,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
  testCustomerProfile,
} from "./customer-api.test-utils";

/** An account without a Dotypos customer yet. */
const profileMissing = new CustomerAccountAccessError({
  reason: "link-required",
  linkReason: "not-found",
});

describe("getAccount", () => {
  const getAccount: CustomerApiCall = { method: "GET", path: "/account" };

  testCustomerEndpointGuards(getAccount);

  test("answers the linked account's state", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    const response = await api.handle(customerApiRequest(getAccount));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "linked",
      email: testCustomerSession.email,
      deletion: "offered",
      assistants: [],
      profile: testCustomerProfile,
      avatar: { kind: "hidden" },
      referralsEnabled: false,
      locale: null,
    });
  });

  test("carries the account's saved locale in every signed-in state", async () => {
    const savedLocale = { ...testCustomerSession, localePreference: "de-DE" };
    const linked = makeCustomerApiTestServer({
      session: savedLocale,
      services: linkedAccountServices,
    });
    const deletionPending = makeCustomerApiTestServer({
      session: { ...savedLocale, deletionRequested: true },
      services: linkedAccountServices,
    });

    const answers = await Promise.all(
      [linked, deletionPending].map(async (api) =>
        (await api.handle(customerApiRequest(getAccount))).json()
      )
    );

    expect(answers).toMatchObject([
      { kind: "linked", locale: "de-DE" },
      { kind: "deletion-pending", locale: "de-DE" },
    ]);
  });

  test("tells the client its remembered referral code is settled", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        referrals: ReferralServiceMock({
          hasSettledReferral: () => Effect.succeed(true),
          getAccountSummary: () =>
            Effect.succeed({
              code: "RFL12345",
              inviteeCount: 0,
              eligibleInviteeCount: 0,
              discount: "0",
              savings: [],
            }) as never,
        }),
      },
      releases: { referralRelease: ReferralReleaseGate.fromDecision(true) },
    });

    const response = await api.handle(
      customerApiRequest({
        ...getAccount,
        headers: { [customerReferralCodeHeader]: "rfl12345" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "linked",
      referralsEnabled: true,
      rememberedReferralCodeUsed: true,
    });
  });

  test("answers the authenticated-unavailable state when Dotypos can't link the account", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        currentAccount: Layer.mock(CurrentCustomerAccount, {
          resolve: Effect.succeed({
            kind: "unavailable",
            session: testCustomerSession,
            reviewMarker: "absent",
            failure: customerAccountUnavailable("dotypos.customer-lookup"),
          }),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(getAccount));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      kind: "authenticated-unavailable",
      email: testCustomerSession.email,
    });
  });
});

describe("updateLocale", () => {
  const updateLocale: CustomerApiCall = {
    method: "PUT",
    path: "/account/locale",
    body: { locale: "de-DE" },
  };

  type LocaleSave = {
    readonly accountId: string;
    readonly locale: string;
  };

  /**
   * Account services with no Dotypos customer, recording every locale save
   * or failing each with `failure`.
   */
  const recordingSaves = (failure?: CustomerAccountAccessError) => {
    const saves: LocaleSave[] = [];
    const services = {
      localePreference: Layer.mock(CustomerLocalePreference, {
        save: (accountId, locale) =>
          failure
            ? Effect.fail(failure)
            : Effect.sync(() => {
                saves.push({ accountId, locale });
              }),
      }),
    };
    return { saves, services };
  };

  testCustomerEndpointGuards(updateLocale);

  test("saves the locale on the session's account, without a Dotypos customer, and echoes it", async () => {
    const { saves, services } = recordingSaves();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(updateLocale));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ locale: "de-DE" });
    expect(saves).toEqual([
      { accountId: testCustomerSession.accountId, locale: "de-DE" },
    ]);
  });

  test("refuses a locale the Workspace doesn't serve, and any other field", async () => {
    const { saves, services } = recordingSaves();
    const api = makeCustomerApiTestServer({ services });

    const responses = await Promise.all(
      [{ locale: "fr-FR" }, { locale: "de-DE", region: "AT" }, {}].map((body) =>
        api.handle(customerApiRequest({ ...updateLocale, body }))
      )
    );

    expect(responses.map(({ status }) => status)).toEqual([400, 400, 400]);
    expect(saves).toEqual([]);
  });

  test("refuses an account whose deletion is pending", async () => {
    const { services } = recordingSaves(
      new CustomerAccountAccessError({
        reason: "link-required",
        linkReason: "deletion-requested",
      })
    );
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(updateLocale));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
  });

  test("asks to sign in again when the session ended before the save", async () => {
    const { services } = recordingSaves(
      new CustomerAccountAccessError({ reason: "unauthenticated" })
    );
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(updateLocale));

    expect(response.status).toBe(401);
  });

  test("answers unavailable, without the cause, when the save fails", async () => {
    const { services } = recordingSaves(
      customerAccountUnavailable("account-locale-preference.write")
    );
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(updateLocale));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("updateProfile", () => {
  const input: CustomerProfileInput = {
    firstName: "Grace",
    lastName: "Hopper",
  };
  const updateProfile: CustomerApiCall = {
    method: "PUT",
    path: "/account/profile",
    body: input,
  };

  /** The linked account's services, recording every profile update. */
  const recordingUpdates = () => {
    const updates: CustomerProfileSave[] = [];
    const services = {
      ...linkedAccountServices,
      profile: Layer.mock(CustomerProfileService, {
        update: (_account, profileInput) =>
          Effect.sync(() => {
            updates.push(profileInput);
            return { ...testCustomerProfile, ...profileInput };
          }),
      }),
    };
    return { updates, services };
  };

  testCustomerEndpointGuards(updateProfile);

  test("saves the linked account's profile", async () => {
    const { updates, services } = recordingUpdates();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(updateProfile));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "updated" });
    expect(updates).toEqual([input]);
  });

  test("saves an entered phone as its phone number, and a blank one as clearing it", async () => {
    const { updates, services } = recordingUpdates();
    const api = makeCustomerApiTestServer({ services });

    const save = (phone: string) =>
      api.handle(
        customerApiRequest({
          ...updateProfile,
          body: { firstName: "Grace", phone },
        })
      );
    const entered = await save("601 123 456");
    const cleared = await save("");

    expect([entered.status, cleared.status]).toEqual([200, 200]);
    expect(updates).toEqual([
      { firstName: "Grace", phone: "+420601123456" },
      { firstName: "Grace", phone: "" },
    ]);
  });

  test("refuses a phone without a phone number", async () => {
    const { updates, services } = recordingUpdates();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest({
        ...updateProfile,
        body: { firstName: "Grace", phone: "call me maybe" },
      })
    );

    expect(response.status).toBe(400);
    expect(updates).toEqual([]);
  });

  test("refuses an account whose deletion is pending", async () => {
    const { updates, services } = recordingUpdates();
    const api = makeCustomerApiTestServer({
      services: {
        ...services,
        resolver: Layer.mock(CustomerAccountResolver, {
          resolve: Effect.fail(
            new CustomerAccountAccessError({
              reason: "link-required",
              linkReason: "deletion-requested",
            })
          ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(updateProfile));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
    expect(updates).toEqual([]);
  });

  test("answers unavailable, without the cause, when Dotypos can't save", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        profile: Layer.mock(CustomerProfileService, {
          update: () =>
            Effect.fail(customerAccountUnavailable("dotypos.customer-lookup")),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(updateProfile));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });

  test("keeps saving after its client disconnects", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const updates: CustomerProfileSave[] = [];
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        profile: Layer.mock(CustomerProfileService, {
          update: (_account, profileInput) =>
            Effect.sync(() => started.resolve()).pipe(
              Effect.andThen(Effect.promise(() => release.promise)),
              Effect.andThen(
                Effect.sync(() => {
                  updates.push(profileInput);
                  return testCustomerProfile;
                })
              )
            ),
        }),
      },
    });
    const client = new AbortController();

    const response = api.handle(
      customerApiRequest({ ...updateProfile, signal: client.signal })
    );
    await started.promise;
    client.abort();
    await Bun.sleep(10);
    release.resolve();

    expect((await response).status).toBe(200);
    expect(updates).toEqual([input]);
  });
});

describe("a read whose client disconnects", () => {
  test("stops", async () => {
    const started = Promise.withResolvers<void>();
    const interrupted = Promise.withResolvers<"interrupted">();
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        currentAccount: Layer.mock(CurrentCustomerAccount, {
          resolve: Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => interrupted.resolve("interrupted"))
            )
          ),
        }),
      },
    });
    const client = new AbortController();

    void api.handle(
      customerApiRequest({
        method: "GET",
        path: "/account",
        signal: client.signal,
      })
    );
    await started.promise;
    client.abort();

    expect(
      await Promise.race([
        interrupted.promise,
        Bun.sleep(1000).then(() => "running"),
      ])
    ).toBe("interrupted");
  });
});

describe("completeProfile", () => {
  const completeProfile: CustomerApiCall = {
    method: "POST",
    path: "/account/profile",
    body: { firstName: "Grace", lastName: "Hopper" },
  };

  /** An account without a Dotypos customer yet, recording every creation. */
  const unlinkedServices = () => {
    const created: CustomerProfileSave[] = [];
    const services = {
      ...linkedAccountServices,
      resolver: Layer.mock(CustomerAccountResolver, {
        resolve: Effect.fail(profileMissing),
      }),
      profile: Layer.mock(CustomerProfileService, {
        create: (_accountId, profileInput) =>
          Effect.sync(() => {
            created.push(profileInput);
            return {
              account: testLinkedAccount,
              profile: testCustomerProfile,
              created: true,
            };
          }),
      }),
    };
    return { created, services };
  };

  testCustomerEndpointGuards(completeProfile);

  test("creates the account's Dotypos customer", async () => {
    const { created, services } = unlinkedServices();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(completeProfile));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "completed" });
    expect(created).toEqual([{ firstName: "Grace", lastName: "Hopper" }]);
  });

  test("creates the customer with the entered phone's phone number", async () => {
    const { created, services } = unlinkedServices();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest({
        ...completeProfile,
        body: { firstName: "Grace", phone: "601 123 456" },
      })
    );

    expect(response.status).toBe(200);
    expect(created).toEqual([{ firstName: "Grace", phone: "+420601123456" }]);
  });

  test("saves nothing for a referral code that can't be used", async () => {
    const { created, services } = unlinkedServices();
    const api = makeCustomerApiTestServer({
      services: {
        ...services,
        referrals: ReferralServiceMock({
          findAvailableCode: () => Effect.succeed(undefined),
        }),
      },
      releases: { referralRelease: ReferralReleaseGate.fromDecision(true) },
    });

    const response = await api.handle(
      customerApiRequest({
        ...completeProfile,
        body: { firstName: "Grace", referralCode: "NOPE1234" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "referral-code-unavailable",
    });
    expect(created).toEqual([]);
  });

  test("refuses an account whose deletion is pending", async () => {
    const { created, services } = unlinkedServices();
    const api = makeCustomerApiTestServer({
      services: {
        ...services,
        resolver: Layer.mock(CustomerAccountResolver, {
          resolve: Effect.fail(
            new CustomerAccountAccessError({
              reason: "link-required",
              linkReason: "deletion-requested",
            })
          ),
        }),
      },
    });

    const response = await api.handle(customerApiRequest(completeProfile));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "deletion-pending",
    });
    expect(created).toEqual([]);
  });
});

describe("removeAvatar", () => {
  const removeAvatar: CustomerApiCall = {
    method: "DELETE",
    path: "/account/avatar",
  };
  const avatarsReleased = {
    avatarRelease: AccountAvatarReleaseGate.fromDecision(true),
  };

  /** The linked account's services, recording every avatar removal. */
  const recordingRemovals = (
    remove: Effect.Effect<void, CustomerAvatarProviderError> = Effect.void
  ) => {
    const removals: string[] = [];
    const services = {
      ...linkedAccountServices,
      avatar: Layer.mock(CustomerAvatarService, {
        remove: (accountId) =>
          Effect.sync(() => removals.push(accountId)).pipe(
            Effect.andThen(remove)
          ),
      }),
    };
    return { removals, services };
  };

  testCustomerEndpointGuards(removeAvatar);

  test("removes the account's avatar", async () => {
    const { removals, services } = recordingRemovals();
    const api = makeCustomerApiTestServer({
      services,
      releases: avatarsReleased,
    });

    const response = await api.handle(customerApiRequest(removeAvatar));

    expect(response.status).toBe(204);
    expect(removals).toEqual([testLinkedAccount.accountId]);
  });

  test("refuses while avatars aren't released, before touching the avatar", async () => {
    const { removals, services } = recordingRemovals();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(removeAvatar));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerFeatureUnavailable",
      feature: "avatars",
    });
    expect(removals).toEqual([]);
  });

  test("answers unavailable when the image provider can't confirm the removal", async () => {
    const { services } = recordingRemovals(
      Effect.fail(new CustomerAvatarProviderError())
    );
    const api = makeCustomerApiTestServer({
      services,
      releases: avatarsReleased,
    });

    const response = await api.handle(customerApiRequest(removeAvatar));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("listPasskeys", () => {
  const listPasskeys: CustomerApiCall = {
    method: "GET",
    path: "/account/passkeys",
  };

  testCustomerEndpointGuards(listPasskeys);

  test("lists the account's passkeys, leaving out what's unknown", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        passkeys: Layer.mock(CustomerPasskeys, {
          list: Effect.succeed([
            {
              id: "passkey-1",
              name: "Laptop",
              provider: undefined,
              createdAt: "2026-10-01T08:00:00.000Z",
            },
          ]),
        }),
      },
      releases: { passkeyRelease: PasskeyReleaseGate.fromDecision(true) },
    });

    const response = await api.handle(customerApiRequest(listPasskeys));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "passkey-1",
        name: "Laptop",
        createdAt: "2026-10-01T08:00:00.000Z",
      },
    ]);
  });

  test("refuses while passkeys aren't released", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    const response = await api.handle(customerApiRequest(listPasskeys));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerFeatureUnavailable",
      feature: "passkeys",
    });
  });
});

describe("listAssistantConnections", () => {
  const listAssistantConnections: CustomerApiCall = {
    method: "GET",
    path: "/account/assistant-connections",
  };

  testCustomerEndpointGuards(listAssistantConnections);

  test("lists the assistants the customer connected, leaving out what's unknown", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        assistants: Layer.mock(CustomerAgentConnections, {
          list: Effect.succeed([
            {
              id: "consent-1",
              name: undefined,
              host: "assistant.example",
              scopes: ["openid", "reservations"],
              administration: false,
              connectedAt: "2026-10-02T09:30:00.000Z",
            },
          ]),
        }),
      },
    });

    const response = await api.handle(
      customerApiRequest(listAssistantConnections)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "consent-1",
        host: "assistant.example",
        scopes: ["openid", "reservations"],
        administration: false,
        connectedAt: "2026-10-02T09:30:00.000Z",
      },
    ]);
  });

  test("answers unavailable when the connections can't be read", async () => {
    const api = makeCustomerApiTestServer({
      services: {
        ...linkedAccountServices,
        assistants: Layer.mock(CustomerAgentConnections, {
          list: Effect.fail(
            customerAccountUnavailable("authentication.session")
          ),
        }),
      },
    });

    const response = await api.handle(
      customerApiRequest(listAssistantConnections)
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

/**
 * The account-scoped marketing preferences the API serves, over a consent
 * ledger that starts with `status` and records each choice, for the
 * session's linked account unless `resolve` answers otherwise.
 */
const marketingServices = ({
  status = "absent",
  ledgerUnavailable = false,
  resolve = Effect.succeed(testLinkedAccount),
}: {
  readonly status?: MarketingConsentStatus;
  readonly ledgerUnavailable?: boolean;
  readonly resolve?: Effect.Effect<
    LinkedCustomerAccount,
    CustomerAccountAccessError
  >;
} = {}) => {
  const records: MarketingConsentRecord[] = [];
  const unavailable = Effect.fail(
    new MarketingConsentUnavailable({ cause: new Error("ledger down") })
  );
  const services = {
    ...linkedAccountServices,
    resolver: Layer.mock(CustomerAccountResolver, { resolve }),
    marketingPreferences: MarketingPreferences.AccountScoped,
    consentLedger: Layer.mock(MarketingConsentLedger, {
      status: () => (ledgerUnavailable ? unavailable : Effect.succeed(status)),
      record: (input) =>
        ledgerUnavailable
          ? unavailable
          : Effect.sync(() => {
              records.push(input);
            }),
    }),
  };
  return { records, services };
};

/** The marketing context of the session's linked account. */
const accountMarketingContext = getAccountMarketingManagementContext(
  testLinkedAccount.accountId,
  testLinkedAccount.dotyposCustomerId
);

describe("getMarketingPreferences", () => {
  const getMarketingPreferences: CustomerApiCall = {
    method: "GET",
    path: "/account/marketing-preferences",
  };

  testCustomerEndpointGuards(getMarketingPreferences);

  test("answers the account's marketing consent", async () => {
    const api = makeCustomerApiTestServer(
      marketingServices({ status: "active" })
    );

    const response = await api.handle(
      customerApiRequest(getMarketingPreferences)
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "active",
      context: accountMarketingContext,
    });
  });

  test("asks an account without a Dotypos profile to complete it", async () => {
    const api = makeCustomerApiTestServer(
      marketingServices({ resolve: Effect.fail(profileMissing) })
    );

    const response = await api.handle(
      customerApiRequest(getMarketingPreferences)
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "profile-missing",
    });
  });

  test("answers unavailable when the consent can't be read", async () => {
    const api = makeCustomerApiTestServer(
      marketingServices({ ledgerUnavailable: true })
    );

    const response = await api.handle(
      customerApiRequest(getMarketingPreferences)
    );

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      _tag: "CustomerServiceUnavailable",
    });
  });
});

describe("saveMarketingPreferences", () => {
  const saveMarketingPreferences = (
    context = accountMarketingContext
  ): CustomerApiCall => ({
    method: "PUT",
    path: "/account/marketing-preferences",
    body: { context, granted: true, confirmed: true, locale: "cs-CZ" },
  });

  testCustomerEndpointGuards(saveMarketingPreferences());

  test("records the choice under the signed-in account's authority", async () => {
    const { records, services } = marketingServices();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest(saveMarketingPreferences())
    );

    expect(response.status).toBe(204);
    expect(records).toEqual([
      {
        customerId: testLinkedAccount.dotyposCustomerId,
        locale: "cs-CZ",
        choice: "grant",
        mode: "explicit",
        channel: "account",
      },
    ]);
  });

  test("asks the client to read again when the consent changed since", async () => {
    const { records, services } = marketingServices();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest(saveMarketingPreferences("an-older-context"))
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerMarketingPreferencesRejected",
      reason: "stale-context",
    });
    expect(records).toEqual([]);
  });

  test("asks an account without a Dotypos profile to complete it", async () => {
    const { records, services } = marketingServices({
      resolve: Effect.fail(profileMissing),
    });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest(saveMarketingPreferences())
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      _tag: "CustomerAccountLinkRequired",
      reason: "profile-missing",
    });
    expect(records).toEqual([]);
  });

  test("answers unavailable when the consent can't be recorded", async () => {
    const { services } = marketingServices({ ledgerUnavailable: true });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest(saveMarketingPreferences())
    );

    expect(response.status).toBe(503);
  });
});

describe("getReferrals", () => {
  const getReferrals: CustomerApiCall = {
    method: "GET",
    path: "/account/referrals",
  };
  const summary = {
    code: "RFL12345",
    inviteeCount: 2,
    eligibleInviteeCount: 1,
    discount: "5",
    savings: [],
  };
  const withSummary = {
    ...linkedAccountServices,
    referrals: ReferralServiceMock({
      getAccountSummary: () => Effect.succeed(summary) as never,
    }),
  };

  testCustomerEndpointGuards(getReferrals);

  test("answers the account's referral summary and share link", async () => {
    const api = makeCustomerApiTestServer({
      services: withSummary,
      releases: { referralRelease: ReferralReleaseGate.fromDecision(true) },
    });

    const response = await api.handle(customerApiRequest(getReferrals));

    expect(response.status).toBe(200);
    const overview = await response.json();
    expect(overview.summary).toEqual(summary);
    expect(new URL(overview.shareUrl).searchParams.size).toBe(1);
    expect([...new URL(overview.shareUrl).searchParams.values()]).toEqual([
      summary.code,
    ]);
  });

  test("refuses while the referral program isn't released", async () => {
    const api = makeCustomerApiTestServer({ services: withSummary });

    const response = await api.handle(customerApiRequest(getReferrals));

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerFeatureUnavailable",
      feature: "referrals",
    });
  });
});

describe("acknowledgeSignupReferral", () => {
  const acknowledgeSignupReferral: CustomerApiCall = {
    method: "POST",
    path: "/account/referrals/signup-acknowledgement",
  };

  /** The linked account's services, recording every acknowledgement. */
  const recordingAcknowledgements = () => {
    const acknowledged: string[] = [];
    const services = {
      ...linkedAccountServices,
      signupIntents: Layer.mock(ReferralSignupIntentRepository, {
        acknowledge: (accountId) =>
          Effect.sync(() => {
            acknowledged.push(accountId);
          }),
      }),
    };
    return { acknowledged, services };
  };

  testCustomerEndpointGuards(acknowledgeSignupReferral);

  test("hides the account's settled signup referral outcome", async () => {
    const { acknowledged, services } = recordingAcknowledgements();
    const api = makeCustomerApiTestServer({
      services,
      releases: { referralRelease: ReferralReleaseGate.fromDecision(true) },
    });

    const response = await api.handle(
      customerApiRequest(acknowledgeSignupReferral)
    );

    expect(response.status).toBe(204);
    expect(acknowledged).toEqual([testLinkedAccount.accountId]);
  });

  test("refuses while the referral program isn't released, keeping the outcome", async () => {
    const { acknowledged, services } = recordingAcknowledgements();
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest(acknowledgeSignupReferral)
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      _tag: "CustomerFeatureUnavailable",
      feature: "referrals",
    });
    expect(acknowledged).toEqual([]);
  });
});

describe("requestDeletion", () => {
  const requestDeletion: CustomerApiCall = {
    method: "POST",
    path: "/account/deletion",
    body: { confirmed: true },
  };

  /** Better Auth's delete-user endpoint answering `result`, recording calls. */
  const deletingWith = (result: CustomerAccountDeletionEndpointResult) => {
    const deletions: Headers[] = [];
    const services = {
      ...linkedAccountServices,
      accountDeletion: Layer.mock(CustomerAccountDeletionEndpoint, {
        deleteCurrentAccount: (requestHeaders) =>
          Effect.sync(() => {
            deletions.push(new Headers(requestHeaders));
            return result;
          }),
      }),
    };
    return { deletions, services };
  };

  testCustomerEndpointGuards(requestDeletion);

  test("deletes the account through Better Auth with the request's session", async () => {
    const { deletions, services } = deletingWith({ status: "deleted" });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest({
        ...requestDeletion,
        headers: { cookie: "session=test" },
      })
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "deleted" });
    expect(deletions.map((headers) => headers.get("cookie"))).toEqual([
      "session=test",
    ]);
  });

  test("asks to sign in again when Better Auth finds the session stale", async () => {
    const { services } = deletingWith({ status: "reauthentication-required" });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(requestDeletion));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "reauthentication-required",
    });
  });

  test("answers a failed deletion without its diagnostic code", async () => {
    const { services } = deletingWith({
      status: "failed",
      code: "account.delete.unexpected",
    });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(customerApiRequest(requestDeletion));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "failed" });
  });

  test("deletes nothing without the customer's confirmation", async () => {
    const { deletions, services } = deletingWith({ status: "deleted" });
    const api = makeCustomerApiTestServer({ services });

    const response = await api.handle(
      customerApiRequest({ ...requestDeletion, body: {} })
    );

    expect(response.status).toBe(400);
    expect(deletions).toEqual([]);
  });
});

describe("overlapping requests in different release cohorts", () => {
  const referralSummary = {
    code: "RFL12345",
    inviteeCount: 0,
    eligibleInviteeCount: 0,
    discount: "0",
    savings: [],
  };
  const withReferralSummary = ReferralServiceMock({
    hasSettledReferral: () => Effect.succeed(false),
    getAccountSummary: () => Effect.succeed(referralSummary) as never,
  });

  // Each endpoint whose Layers carry a release gate, with services under
  // which an open and a closed gate answer differently.
  const gatedEndpoints: ReadonlyArray<{
    readonly call: CustomerApiCall;
    readonly services: CustomerAccountServiceLayers;
  }> = [
    {
      call: { method: "GET", path: "/account" },
      services: { ...linkedAccountServices, referrals: withReferralSummary },
    },
    {
      call: {
        method: "POST",
        path: "/account/profile",
        body: { firstName: "Grace", referralCode: "NOPE1234" },
      },
      services: {
        ...linkedAccountServices,
        resolver: Layer.mock(CustomerAccountResolver, {
          resolve: Effect.fail(profileMissing),
        }),
        profile: Layer.mock(CustomerProfileService, {
          create: () =>
            Effect.succeed({
              account: testLinkedAccount,
              profile: testCustomerProfile,
              created: true,
            }),
        }),
        referrals: ReferralServiceMock({
          findAvailableCode: () => Effect.succeed(undefined),
        }),
      },
    },
    {
      call: { method: "DELETE", path: "/account/avatar" },
      services: {
        ...linkedAccountServices,
        avatar: Layer.mock(CustomerAvatarService, {
          remove: () => Effect.void,
        }),
      },
    },
    {
      call: { method: "GET", path: "/account/passkeys" },
      services: linkedAccountServices,
    },
    {
      call: { method: "GET", path: "/account/referrals" },
      services: { ...linkedAccountServices, referrals: withReferralSummary },
    },
    {
      call: {
        method: "POST",
        path: "/account/referrals/signup-acknowledgement",
      },
      services: {
        ...linkedAccountServices,
        signupIntents: Layer.mock(ReferralSignupIntentRepository, {
          acknowledge: () => Effect.void,
        }),
      },
    },
  ];

  for (const { call, services } of gatedEndpoints) {
    test(`${call.method} ${call.path} answers each request as its own cohort's release gates decide`, async () => {
      expectEachCohortAnsweredAlone(
        await answerInEachReleaseCohort({
          serve: (featureFlags) =>
            makeCustomerApiTestServer({
              services,
              releases: accountReleasesOver(featureFlags),
            }),
          send: (cohort) => customerApiRequest(inReleaseCohort(call, cohort)),
        })
      );
    });
  }
});
