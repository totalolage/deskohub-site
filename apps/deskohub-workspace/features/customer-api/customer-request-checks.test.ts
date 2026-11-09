import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { CustomerAccountAccessError } from "@/features/account/customer-account";
import {
  type CustomerApiCall,
  type CustomerApiTestOptions,
  customerApiRequest,
  linkedAccountServices,
  makeCustomerApiTestServer,
  trustedOrigin,
  unavailableSession,
  withoutClientHeader,
} from "./customer-api.test-utils";

const updateProfile: CustomerApiCall = {
  method: "PUT",
  path: "/account/profile",
  body: { firstName: "Ada" },
};
const getAccount: CustomerApiCall = { method: "GET", path: "/account" };
const getMarketingPreferences: CustomerApiCall = {
  method: "GET",
  path: "/account/marketing-preferences",
};
const orderId = "019edbcf-5026-7ecc-821b-eda46998eaaa";
const listReservations: CustomerApiCall = {
  method: "GET",
  path: "/reservations",
};
const getReservationStatus: CustomerApiCall = {
  method: "GET",
  path: `/reservations/${orderId}/status`,
};
const getReservationAccess: CustomerApiCall = {
  method: "GET",
  path: `/reservations/${orderId}/access`,
};
const getAvailability: CustomerApiCall = {
  method: "GET",
  path: "/booking/availability?kind=cowork",
};
const listPasskeys: CustomerApiCall = {
  method: "GET",
  path: "/account/passkeys",
};

const serve = async (
  call: CustomerApiCall,
  options: CustomerApiTestOptions = {}
) => {
  const api = makeCustomerApiTestServer({
    services: linkedAccountServices,
    ...options,
  });
  const response = await api.handle(customerApiRequest(call));
  return {
    status: response.status,
    body: await response.json(),
    cacheControl: response.headers.get("cache-control"),
    ...api.records,
  };
};

const rejected = { _tag: "CustomerRequestRejected" };

describe("customer request origin check", () => {
  test("refuses a mutation without the client header before any session lookup", async () => {
    const result = await serve(withoutClientHeader(updateProfile));

    expect([result.status, result.body]).toEqual([403, rejected]);
    expect(result.sessionReads).toBe(0);
  });

  test("refuses a read without the client header too", async () => {
    const result = await serve(withoutClientHeader(getAccount));

    expect([result.status, result.body]).toEqual([403, rejected]);
  });

  test("serves a request from an origin Better Auth trusts", async () => {
    const result = await serve({
      ...updateProfile,
      headers: { origin: trustedOrigin, "sec-fetch-site": "same-origin" },
    });

    expect([result.status, result.body]).toEqual([200, { status: "updated" }]);
  });

  test("serves a native client that sends no Origin", async () => {
    const result = await serve(updateProfile);

    expect(result.status).toBe(200);
  });

  test("refuses an origin Better Auth doesn't trust", async () => {
    const result = await serve({
      ...updateProfile,
      headers: { origin: "https://attacker.example" },
    });

    expect([result.status, result.body]).toEqual([403, rejected]);
    expect(result.sessionReads).toBe(0);
  });

  // The origin check's only public error is the 403, so an origin Better
  // Auth can't vouch for is refused as untrusted, never served.
  test("refuses the request when Better Auth can't say whether its origin is trusted", async () => {
    const result = await serve(
      { ...updateProfile, headers: { origin: trustedOrigin } },
      { isTrustedOrigin: () => "unavailable" }
    );

    expect([result.status, result.body]).toEqual([403, rejected]);
    expect(result.sessionReads).toBe(0);
  });

  test("refuses a request the browser marks cross-site, even without an Origin", async () => {
    const result = await serve({
      ...getAccount,
      headers: { "sec-fetch-site": "cross-site" },
    });

    expect([result.status, result.body]).toEqual([403, rejected]);
    expect(result.sessionReads).toBe(0);
  });

  test("runs before session authentication: a request failing both gets 403 without a session lookup", async () => {
    const result = await serve(withoutClientHeader(updateProfile), {
      session: null,
    });

    expect([result.status, result.body]).toEqual([403, rejected]);
    expect(result.sessionReads).toBe(0);
    expect(result.budgetSpends).toEqual([]);
  });
});

describe("customer session authentication", () => {
  test("asks a caller without a session to sign in", async () => {
    const result = await serve(updateProfile, { session: null });

    expect([result.status, result.body]).toEqual([
      401,
      { _tag: "CustomerSessionRequired" },
    ]);
    expect(result.budgetSpends).toEqual([]);
  });

  test("asks a caller with an unverified email to sign in", async () => {
    const result = await serve(updateProfile, {
      session: {
        failure: new CustomerAccountAccessError({
          reason: "unverified-email",
        }),
      },
    });

    expect([result.status, result.body]).toEqual([
      401,
      { _tag: "CustomerSessionRequired" },
    ]);
  });

  test("answers unavailable when the session can't be read", async () => {
    const result = await serve(getAccount, { session: unavailableSession });

    expect([result.status, result.body]).toEqual([
      503,
      { _tag: "CustomerServiceUnavailable" },
    ]);
  });

  test("answers unavailable when authentication isn't configured", async () => {
    const result = await serve(getAccount, {
      session: {
        failure: new CustomerAccountAccessError({ reason: "not-configured" }),
      },
    });

    expect(result.status).toBe(503);
  });
});

describe("customer request budgets", () => {
  test("spends the general and the account read budget on an account read, under keys without the account id", async () => {
    const result = await serve(getAccount);

    expect(result.status).toBe(200);
    const keys = result.budgetSpends.map(({ key }) => key);
    expect(keys).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:account-read:account:/),
    ]);
    expect(keys.join()).not.toContain("operations-test-account");
  });

  test("spends the general and the Dotypos read budget on another Dotypos-backed read", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    await api.handle(customerApiRequest(getMarketingPreferences));

    expect(api.records.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:dotypos-read:account:/),
    ]);
  });

  test("spends the general and the Dotypos mutation budget on a Dotypos-backed mutation", async () => {
    const result = await serve(updateProfile);

    expect(result.status).toBe(200);
    expect(result.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:dotypos-mutation:account:/),
    ]);
  });

  test("spends the general and the catalog budget on a booking catalog read", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    await api.handle(customerApiRequest(getAvailability));

    expect(api.records.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:catalog-read:account:/),
    ]);
  });

  test("spends only the general budget on an endpoint that never calls Dotypos", async () => {
    const result = await serve(listPasskeys);

    expect(result.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
    ]);
  });

  /** The statuses of `count` calls through one server. */
  const statusesOf = async (
    api: ReturnType<typeof makeCustomerApiTestServer>,
    call: CustomerApiCall,
    count: number
  ) => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < count; attempt += 1) {
      const response = await api.handle(customerApiRequest(call));
      statuses.push(response.status);
      if (response.status === 429) {
        expect(await response.json()).toEqual({ _tag: "CustomerRateLimited" });
      }
    }
    return statuses;
  };

  test("refuses as rate limited once the account made 40 account reads, and still serves its other reads and its mutations", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    expect(await statusesOf(api, getAccount, 41)).toEqual([
      ...Array(40).fill(200),
      429,
    ]);
    expect(await statusesOf(api, getMarketingPreferences, 1)).not.toEqual([
      429,
    ]);
    expect(await statusesOf(api, updateProfile, 1)).toEqual([200]);
  });

  test("refuses as rate limited once the account spent its Dotypos read budget, and still serves its account reads and mutations", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    const statuses = await statusesOf(api, getMarketingPreferences, 21);

    expect(statuses.slice(0, 20)).not.toContain(429);
    expect(statuses[20]).toBe(429);
    expect(await statusesOf(api, getAccount, 1)).toEqual([200]);
    expect(await statusesOf(api, updateProfile, 1)).toEqual([200]);
  });

  // The per-flow cost the budget comment documents: opening the app reads
  // the account and the history; a booking reads the account at the booking
  // screen, the order's status once and then up to nine times while the
  // payment return settles, the history and the door code. Two bookings
  // and a session's navigation stay under the budget. Navigation comes
  // last, so both polling sequences run with the app's reserve still free.
  test("spends 38 account reads on two bookings with full payment-return polling and a session's navigation, and refuses none of them", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });
    const booking = [
      getAccount,
      ...Array(10).fill(getReservationStatus),
      listReservations,
      getReservationAccess,
    ];
    const navigation = [
      ...Array(5).fill(getAccount),
      ...Array(5).fill(listReservations),
    ];
    const session = [
      getAccount,
      listReservations,
      ...booking,
      ...booking,
      ...navigation,
    ];

    const statuses: number[] = [];
    for (const call of session) {
      statuses.push(...(await statusesOf(api, call, 1)));
    }

    expect(session).toHaveLength(38);
    expect(statuses).not.toContain(429);
    expect(
      api.records.budgetSpends.filter(({ key }) =>
        key.startsWith("customer-api:account-read:")
      )
    ).toHaveLength(38);
    expect(await statusesOf(api, getAccount, 3)).toEqual([200, 200, 429]);
  });

  test("refuses as rate limited once the account spent its Dotypos mutation budget, and still serves its reads", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    expect(await statusesOf(api, updateProfile, 16)).toEqual([
      ...Array(15).fill(200),
      429,
    ]);
    expect(await statusesOf(api, getAccount, 1)).toEqual([200]);
  });

  test("keeps serving catalog reads once the account spent its account read budget", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    await statusesOf(api, getAccount, 40);

    expect(await statusesOf(api, getAccount, 1)).toEqual([429]);
    expect(await statusesOf(api, getAvailability, 1)).not.toEqual([429]);
  });

  test("refuses as rate limited once the account made 120 catalog reads", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    const statuses = await statusesOf(api, getAvailability, 121);

    expect(statuses.slice(0, 120)).not.toContain(429);
    expect(statuses[120]).toBe(429);
  });

  test("refuses as rate limited once the account made 120 requests of any kind", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    const statuses = await statusesOf(api, listPasskeys, 121);

    expect(statuses.slice(0, 120)).not.toContain(429);
    expect(statuses[120]).toBe(429);
  });

  test("fails closed when the budget can't be checked", async () => {
    const result = await serve(updateProfile, { budgetUnavailable: true });

    expect([result.status, result.body]).toEqual([
      503,
      { _tag: "CustomerServiceUnavailable" },
    ]);
  });
});

describe("customer API responses", () => {
  test("are private and uncached, refusals included", async () => {
    const served = await serve(getAccount);
    const unauthenticated = await serve(getAccount, { session: null });
    const refused = await serve(withoutClientHeader(getAccount));

    expect([served, unauthenticated, refused].map((r) => r.status)).toEqual([
      200, 401, 403,
    ]);
    for (const result of [served, unauthenticated, refused]) {
      expect(result.cacheControl).toBe("private, no-store");
    }
  });
});
