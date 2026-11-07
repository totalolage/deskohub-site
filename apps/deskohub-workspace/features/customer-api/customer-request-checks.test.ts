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
  test("spends the general and the Dotypos read budget on a Dotypos-backed read, under keys without the account id", async () => {
    const result = await serve(getAccount);

    expect(result.status).toBe(200);
    const keys = result.budgetSpends.map(({ key }) => key);
    expect(keys).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:dotypos-read:account:/),
    ]);
    expect(keys.join()).not.toContain("operations-test-account");
  });

  test("spends the general and the Dotypos mutation budget on a Dotypos-backed mutation", async () => {
    const result = await serve(updateProfile);

    expect(result.status).toBe(200);
    expect(result.budgetSpends.map(({ key }) => key)).toEqual([
      expect.stringMatching(/^customer-api:account:/),
      expect.stringMatching(/^customer-api:dotypos-mutation:account:/),
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

  test("refuses as rate limited once the account spent its Dotypos read budget, and still serves its mutations", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    expect(await statusesOf(api, getAccount, 21)).toEqual([
      ...Array(20).fill(200),
      429,
    ]);
    expect(await statusesOf(api, updateProfile, 1)).toEqual([200]);
  });

  test("refuses as rate limited once the account spent its Dotypos mutation budget, and still serves its reads", async () => {
    const api = makeCustomerApiTestServer({ services: linkedAccountServices });

    expect(await statusesOf(api, updateProfile, 7)).toEqual([
      ...Array(6).fill(200),
      429,
    ]);
    expect(await statusesOf(api, getAccount, 1)).toEqual([200]);
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
