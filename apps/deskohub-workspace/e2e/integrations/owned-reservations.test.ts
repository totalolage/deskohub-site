import { expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { getDatasourceConfig } from "../config";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import type { RunOwnership } from "../soak-ownership";
import { getDotyposLayer } from "./dotypos";
import { enumerateRunOwnedReservations } from "./owned-reservations";

const email = testEmailAddress("delivered+owned-query");
const ownership: RunOwnership = {
  intents: [
    {
      id: "before-orphan-create",
      runId: "12345-1",
      caseId: "checkout-cowork-basic",
      owner: { email },
      startDate: "2027-01-01T00:00:00Z",
      endDate: "2027-01-02T00:00:00Z",
    },
    {
      id: "account-first",
      runId: "12345-1",
      caseId: "account-reservation-transitions",
      owner: { customerId: "account-owner" },
      startDate: "2027-05-01T08:00:00Z",
      endDate: "2027-05-01T10:00:00Z",
    },
    {
      id: "account-second",
      runId: "12345-1",
      caseId: "account-reservation-transitions",
      owner: { customerId: "account-owner" },
      startDate: "2027-05-01T08:00:00Z",
      endDate: "2027-05-01T10:00:00Z",
    },
  ],
  emails: [email],
  customerIds: ["account-owner"],
  accountIds: [],
  journalCount: 2,
};

const fixture = async (
  mode:
    | "active"
    | "cancelled"
    | "bad-page"
    | "page-failure"
    | "missing-customer"
    | "customer-page"
    | "missing-owner"
) => {
  const requests: { readonly method: string; readonly path: string }[] = [];
  const intervals = new Set<string>();
  const customers = [
    { id: "orphan-owner", email, deleted: false },
    { id: "deleted-duplicate-owner", email, deleted: true },
    {
      id: "account-owner",
      email: testEmailAddress("delivered+account-owner"),
      deleted: true,
    },
    {
      id: "paid-owner",
      email: testEmailAddress("delivered+paid-owner"),
      deleted: false,
    },
    {
      id: "foreign-owner",
      email: testEmailAddress("delivered+foreign-owner"),
      deleted: false,
    },
  ];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname });
      if (url.pathname === "/signin/token")
        return Response.json({ accessToken: "synthetic-access-token" });
      if (url.pathname === "/clouds/cloud/reservations") {
        const filter = url.searchParams.get("filter") ?? "";
        intervals.add(filter);
        const farFuture = filter.includes(
          String(Date.parse("2027-05-01T10:00:00Z"))
        );
        const ids = farFuture
          ? ["account-first", "account-second"]
          : ["orphan", "duplicate", "paid-unlinked", "foreign"];
        const ownerIds = farFuture
          ? ["account-owner", "account-owner"]
          : [
              "orphan-owner",
              "deleted-duplicate-owner",
              "paid-owner",
              "foreign-owner",
            ];
        const page = Number(url.searchParams.get("page"));
        if (mode === "page-failure" && page === 2)
          return new Response(null, { status: 400 });
        const index = page - 1;
        const data =
          index < ids.length
            ? [
                {
                  id: ids[index],
                  _cloudId: "cloud",
                  _branchId: "branch",
                  _tableId: "table",
                  ...(mode === "missing-owner"
                    ? {}
                    : { _customerId: ownerIds[index] }),
                  startDate: farFuture
                    ? "2027-05-01T08:00:00Z"
                    : "2027-01-01T08:00:00Z",
                  endDate: farFuture
                    ? "2027-05-01T10:00:00Z"
                    : "2027-01-01T10:00:00Z",
                  status: mode === "cancelled" ? "CANCELLED" : "CONFIRMED",
                  seats: "1",
                },
              ]
            : [];
        let nextPage: string | null =
          page < ids.length ? String(page + 1) : null;
        if (mode === "bad-page") nextPage = "1";
        return Response.json({ currentPage: String(page), data, nextPage });
      }
      if (url.pathname === "/clouds/cloud/customers") {
        expect(url.searchParams.get("filter")).toContain("deleted|in|0,1");
        const ids = (url.searchParams.get("filter") ?? "")
          .split(";")[0]!
          .slice("id|in|".length)
          .split(",");
        const page = Number(url.searchParams.get("page"));
        const selected = customers.filter(({ id }) => ids.includes(id));
        return Response.json({
          currentPage: String(page),
          data:
            mode === "missing-customer"
              ? []
              : selected.map((customer) => ({
                  ...customer,
                  _cloudId: "cloud",
                  firstName: "Synthetic",
                  points: null,
                  flags: "0",
                  display: true,
                })),
          nextPage: mode === "customer-page" ? "2" : null,
        });
      }
      return new Response(null, { status: 400 });
    },
  });
  const config = getDatasourceConfig(
    makeTestE2EEnvironment({
      DOTYPOS_API_URL: `http://127.0.0.1:${server.port}`,
    })
  );
  try {
    const result = await Effect.runPromise(
      enumerateRunOwnedReservations(ownership, [
        {
          dotyposCustomerId: DotyposCustomerIdSchema.make("paid-owner"),
          dotyposReservationId: null,
        },
      ]).pipe(Effect.provide(getDotyposLayer(config)))
    );
    expect(intervals.size).toBe(2);
    expect(
      [...intervals].every((filter) =>
        filter.startsWith("status|in|NEW,CONFIRMED;")
      )
    ).toBe(true);
    expect(
      requests.every(
        ({ method, path }) =>
          method === "GET" || (method === "POST" && path === "/signin/token")
      )
    ).toBe(true);
    return result;
  } finally {
    await server.stop(true);
  }
};

test("counts unjournaled orphan and deleted duplicate owners, paid-unlinked rows, and both disjoint far-future account reservations", async () => {
  const result = await fixture("active");
  expect(result.ownedActiveCount).toBe(5);
  expect(result.pageCount).toBe(6);
  expect(result.intervalCount).toBe(2);
  expect(result.responseSha256).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(result)).not.toContain(email);
});

test("the existing cancellation semantics produce an observed zero", async () => {
  expect((await fixture("cancelled")).ownedActiveCount).toBe(0);
});

for (const mode of [
  "bad-page",
  "page-failure",
  "missing-customer",
  "customer-page",
  "missing-owner",
] as const) {
  test(`${mode} invalidates enumeration rather than returning zero`, async () => {
    const pending = fixture(mode);
    let rejected = false;
    try {
      await pending;
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });
}
