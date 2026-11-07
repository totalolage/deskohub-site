import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { customerReferralCodeHeader } from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import {
  testCustomerSession,
  testLinkedAccount,
} from "@/features/account/backend/account-operations.test-utils";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { CustomerProfileService } from "@/features/account/backend/customer-profile.service";
import type { CustomerProfileInput } from "@/features/account/contracts";
import {
  CustomerAccountAccessError,
  customerAccountUnavailable,
} from "@/features/account/customer-account";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import {
  type CustomerApiCall,
  customerApiRequest,
  linkedAccountServices,
  makeCustomerApiTestServer,
  testCustomerEndpointGuards,
  testCustomerProfile,
} from "./customer-api.test-utils";

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
    });
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
        resolver: Layer.mock(CustomerAccountResolver, {
          resolveLink: Effect.fail(
            customerAccountUnavailable("dotypos.customer-lookup")
          ),
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
    const updates: CustomerProfileInput[] = [];
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
    const updates: CustomerProfileInput[] = [];
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
        resolver: Layer.mock(CustomerAccountResolver, {
          resolveLink: Effect.sync(() => started.resolve()).pipe(
            Effect.andThen(Effect.never),
            Effect.onInterrupt(() =>
              Effect.sync(() => interrupted.resolve("interrupted"))
            )
          ),
          resolve: Effect.succeed(testLinkedAccount),
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
