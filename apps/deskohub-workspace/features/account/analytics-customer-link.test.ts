import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos/types";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  type WorkspaceBrowserLogRecord,
} from "@/shared/browser/workspace-browser-logs";
import {
  type AccountCustomerLinkResponse,
  accountCustomerLinkPath,
} from "./account-customer-link";
import {
  getAnalyticsDotyposCustomerId,
  refreshAnalyticsDotyposCustomerId,
  requestAnalyticsDotyposCustomerId,
  subscribeAnalyticsDotyposCustomerId,
} from "./analytics-customer-link";
import { customerAccountIdSchema } from "./customer-account";

type PendingRequest = {
  readonly init: RequestInit | undefined;
  readonly input: string;
  readonly respond: (response: Response) => void;
};

const originalFetch = globalThis.fetch;
const requests: PendingRequest[] = [];

const fakeFetch = (input: RequestInfo | URL, init?: RequestInit) =>
  new Promise<Response>((resolve) => {
    requests.push({ init, input: String(input), respond: resolve });
  });

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const respondNext = async (
  body: AccountCustomerLinkResponse | { readonly error: string },
  status = 200
) => {
  const request = requests.shift();
  if (!request) throw new Error("No pending customer link request");
  request.respond(Response.json(body, { status }));
  await settle();
};

// The module keeps its cache for the page's lifetime, so each case uses its
// own synthetic account.
const accountId = (value: string) => customerAccountIdSchema.make(value);
const customerId = (value: string) => DotyposCustomerIdSchema.make(value);

describe("analytics Dotypos customer link", () => {
  let notifications = 0;
  let unsubscribe: (() => void) | undefined;
  let detachLogs: (() => void) | undefined;
  let records: WorkspaceBrowserLogRecord[] = [];

  beforeEach(() => {
    globalThis.fetch = Object.assign(fakeFetch, {
      preconnect: originalFetch.preconnect,
    });
    requests.length = 0;
    notifications = 0;
    unsubscribe = subscribeAnalyticsDotyposCustomerId(() => {
      notifications += 1;
    });
    discardWorkspaceBrowserLogs();
    records = [];
    detachLogs = deliverWorkspaceBrowserLogs((record) => records.push(record));
  });

  afterEach(async () => {
    while (requests.length > 0) {
      await respondNext({ accountId: null, dotyposCustomerId: null });
    }
    unsubscribe?.();
    detachLogs?.();
    discardWorkspaceBrowserLogs();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  test("loads the account's customer ID once and notifies subscribers", async () => {
    const account = accountId("link-account-a");

    requestAnalyticsDotyposCustomerId(account);
    requestAnalyticsDotyposCustomerId(account);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.input).toBe(accountCustomerLinkPath);
    expect(requests[0]?.init).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
    });
    expect(getAnalyticsDotyposCustomerId(account)).toBeUndefined();

    await respondNext({
      accountId: account,
      dotyposCustomerId: customerId("customer-a"),
    });

    expect(getAnalyticsDotyposCustomerId(account)).toBe(
      customerId("customer-a")
    );
    expect(notifications).toBe(1);

    requestAnalyticsDotyposCustomerId(account);
    expect(requests).toHaveLength(0);
  });

  test("keeps nothing for an account without a customer and asks again later", async () => {
    const account = accountId("link-account-none");

    requestAnalyticsDotyposCustomerId(account);
    await respondNext({ accountId: account, dotyposCustomerId: null });

    expect(getAnalyticsDotyposCustomerId(account)).toBeUndefined();
    expect(notifications).toBe(0);

    requestAnalyticsDotyposCustomerId(account);
    expect(requests).toHaveLength(1);
  });

  test("ignores a response for a different session account", async () => {
    const account = accountId("link-account-b");

    requestAnalyticsDotyposCustomerId(account);
    await respondNext({
      accountId: accountId("link-account-other"),
      dotyposCustomerId: customerId("customer-other"),
    });

    expect(getAnalyticsDotyposCustomerId(account)).toBeUndefined();
    expect(
      getAnalyticsDotyposCustomerId(accountId("link-account-other"))
    ).toBeUndefined();
    expect(notifications).toBe(0);
  });

  test("refreshes after profile completion creates the customer", async () => {
    const account = accountId("link-account-completion");

    requestAnalyticsDotyposCustomerId(account);
    await respondNext({ accountId: account, dotyposCustomerId: null });

    refreshAnalyticsDotyposCustomerId();
    expect(requests).toHaveLength(1);
    await respondNext({
      accountId: account,
      dotyposCustomerId: customerId("customer-completed"),
    });

    expect(getAnalyticsDotyposCustomerId(account)).toBe(
      customerId("customer-completed")
    );
    expect(notifications).toBe(1);
  });

  test("reloads once when a refresh arrives while an older load is in flight", async () => {
    const account = accountId("link-account-in-flight");

    requestAnalyticsDotyposCustomerId(account);
    refreshAnalyticsDotyposCustomerId();
    expect(requests).toHaveLength(1);

    await respondNext({ accountId: account, dotyposCustomerId: null });
    expect(requests).toHaveLength(1);
    await respondNext({
      accountId: account,
      dotyposCustomerId: customerId("customer-c"),
    });

    expect(getAnalyticsDotyposCustomerId(account)).toBe(
      customerId("customer-c")
    );
    expect(requests).toHaveLength(0);
  });

  test("reports a failed load with a fixed code and keeps nothing", async () => {
    const account = accountId("link-account-failure");

    requestAnalyticsDotyposCustomerId(account);
    await respondNext({ error: "unavailable" }, 503);

    expect(getAnalyticsDotyposCustomerId(account)).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0]?.attributes).toMatchObject({
      failureCode: "account.analytics-customer-link.load-failed",
      operation: "account.analytics-customer-link.load",
      status: 503,
    });
    expect(JSON.stringify(records)).not.toContain(account);

    requestAnalyticsDotyposCustomerId(account);
    expect(requests).toHaveLength(1);
  });
});
