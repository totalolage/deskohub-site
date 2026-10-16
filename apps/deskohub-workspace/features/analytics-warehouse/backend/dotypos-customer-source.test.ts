import { describe, expect, test } from "bun:test";
import {
  type CustomerChanges,
  type CustomerChangesOptions,
  type DotyposCustomer,
  DotyposCustomerSchema,
  ExternalAPIError,
} from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { testEmailAddress } from "@deskohub/test-email";
import {
  DateTime,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Redacted,
  Schema,
} from "effect";
import {
  RequestBudget,
  type RequestBudgetPolicy,
  type RequestBudgetSpend,
  RequestBudgetUnavailable,
} from "@/shared/backend/request-budget/request-budget.service";
import {
  dotyposCustomerExportBudget,
  respondWithDotyposCustomerSource,
} from "./dotypos-customer-source";
import { DotyposCustomerSourceAccess } from "./dotypos-customer-source-access.service";

const sourceToken = "synthetic-source-token-0123456789abcdef";
const sourceUrl =
  "https://workspace.example.test/api/analytics-warehouse/dotypos-customers";
const excludedValueMarker = "synthetic-excluded-value";

const exportedFields = [
  "id",
  "firstName",
  "lastName",
  "companyName",
  "email",
  "phone",
  "addressLine1",
  "addressLine2",
  "city",
  "zip",
  "country",
  "birthday",
  "_discountGroupId",
  "points",
  "tags",
  "created",
  "versionDate",
  "deleted",
] as const;

type EncodedCustomer = typeof DotyposCustomerSchema.Encoded;

type CustomerOverrides = {
  readonly [Field in keyof EncodedCustomer]?:
    | EncodedCustomer[Field]
    | undefined;
};

type ExportedRow = {
  readonly [Field in (typeof exportedFields)[number]]: unknown;
};

const customer = (overrides: CustomerOverrides = {}): DotyposCustomer =>
  Schema.decodeUnknownSync(DotyposCustomerSchema)(
    withoutUndefinedProperties({
      id: "1001",
      _cloudId: "2001",
      _discountGroupId: "3001",
      _sellerId: "4001",
      firstName: "Ada",
      lastName: "Synthetic",
      companyName: "Synthetic Studio",
      companyId: excludedValueMarker,
      email: testEmailAddress("ada"),
      phone: "+420000000000",
      addressLine1: "Example Street 1",
      addressLine2: "Floor 2",
      city: "Example City",
      zip: "00000",
      country: "CZ",
      vatId: excludedValueMarker,
      barcode: excludedValueMarker,
      birthday: "1990-01-01T00:00:00.000Z",
      created: "2026-01-01T00:00:00.000Z",
      expireDate: excludedValueMarker,
      externalId: excludedValueMarker,
      headerPrint: excludedValueMarker,
      hexColor: excludedValueMarker,
      internalNote: excludedValueMarker,
      modifiedBy: excludedValueMarker,
      note: excludedValueMarker,
      tags: ["member"],
      points: "12",
      flags: excludedValueMarker,
      display: true,
      deleted: false,
      versionDate: "2026-10-01T12:00:00.000Z",
      ...overrides,
    })
  );

const withoutUndefinedProperties = (value: CustomerOverrides) =>
  Object.fromEntries(
    Object.entries(value).filter(([, property]) => property !== undefined)
  );

type SourceRun = {
  readonly response: Response;
  readonly listRequests: readonly CustomerChangesOptions[];
  readonly calls: readonly string[];
  readonly budgetPolicies: readonly RequestBudgetPolicy[];
};

type ListCustomerChanges = (
  options: CustomerChangesOptions
) => Effect.Effect<CustomerChanges, ExternalAPIError>;

const requestSource = async (input: {
  readonly url?: string;
  readonly authorization?: string | null;
  readonly token?: string | null;
  readonly changes?: Effect.Effect<CustomerChanges, ExternalAPIError>;
  readonly dotypos?: ListCustomerChanges;
  readonly budget?: Effect.Effect<RequestBudgetSpend, RequestBudgetUnavailable>;
}): Promise<SourceRun> => {
  const listRequests: CustomerChangesOptions[] = [];
  const calls: string[] = [];
  const budgetPolicies: RequestBudgetPolicy[] = [];
  const headers = new Headers();
  const authorization =
    input.authorization === undefined
      ? `Bearer ${sourceToken}`
      : input.authorization;
  if (authorization !== null) headers.set("authorization", authorization);
  const token = input.token === undefined ? sourceToken : input.token;

  const response = await Effect.runPromise(
    respondWithDotyposCustomerSource(
      new Request(input.url ?? sourceUrl, { headers })
    ).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DotyposCustomerSourceAccess, {
            token:
              token === null
                ? Option.none()
                : Option.some(Redacted.make(token)),
          }),
          Layer.succeed(RequestBudget, {
            spend: (policy: RequestBudgetPolicy) => {
              calls.push("budget");
              budgetPolicies.push(policy);
              return input.budget ?? Effect.succeed({ _tag: "Granted" });
            },
          }),
          DotyposServiceMock({
            listCustomerChanges: (options: CustomerChangesOptions) => {
              calls.push("dotypos");
              listRequests.push(options);
              return input.dotypos
                ? input.dotypos(options)
                : (input.changes ?? singlePage([]));
            },
          })
        )
      )
    )
  );
  return { response, listRequests, calls, budgetPolicies };
};

const singlePage = (
  customers: readonly DotyposCustomer[],
  hasMore = false
): Effect.Effect<CustomerChanges> =>
  Effect.succeed({ customers, hasMore, totalCount: Option.none() });

const readPage = async (response: Response) =>
  (await response.json()) as {
    readonly results: readonly ExportedRow[];
    readonly next_cursor: string | null;
  };

const epochMillis = (iso: string) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(iso));

const firstVersion = "2026-10-01T12:00:00.000Z";
const laterVersion = "2026-10-01T12:05:00.000Z";

/**
 * A synthetic Dotypos customer list that filters, orders, pages, and counts
 * like the customer list endpoint. Tests edit `customers` between requests.
 */
const makeDotyposStore = (
  customers: DotyposCustomer[],
  options: { readonly counted?: boolean } = {}
) => {
  const versionOf = (candidate: DotyposCustomer) =>
    candidate.versionDate === undefined
      ? undefined
      : epochMillis(candidate.versionDate);
  const listCustomerChanges: ListCustomerChanges = ({ selection, page }) => {
    const matching = customers.filter((candidate) => {
      const version = versionOf(candidate);
      return Match.valueTags(selection, {
        Dated: () => version !== undefined,
        ChangedFrom: ({ versionDate }) =>
          version !== undefined &&
          version >= DateTime.toEpochMillis(versionDate),
        ChangedAfter: ({ versionDate }) =>
          version !== undefined &&
          version > DateTime.toEpochMillis(versionDate),
        ChangedAt: ({ versionDate }) =>
          version === DateTime.toEpochMillis(versionDate),
        Undated: () => version === undefined,
      });
    });
    const ordered = matching.sort((left, right) =>
      selection._tag === "ChangedAt" || selection._tag === "Undated"
        ? Number(left.id) - Number(right.id)
        : (versionOf(left) ?? 0) - (versionOf(right) ?? 0)
    );
    return Effect.succeed({
      customers: ordered.slice((page - 1) * 100, page * 100),
      hasMore: ordered.length > page * 100,
      totalCount:
        options.counted === false ? Option.none() : Option.some(ordered.length),
    });
  };
  return { customers, listCustomerChanges };
};

const customersAt = (versionDate: string, count: number, firstId = 1) =>
  Array.from({ length: count }, (_, index) =>
    customer({ id: `${firstId + index}`, versionDate })
  );

/**
 * Follows `next_cursor` the way PostHog's cursor-in-body paginator does,
 * sending `since` with every page, until the cursor is null.
 */
const syncLikePostHog = async (input: {
  readonly store: ReturnType<typeof makeDotyposStore>;
  readonly since?: string;
  readonly beforeRequest?: (requestIndex: number) => void;
}) => {
  const rows: ExportedRow[] = [];
  const selections: string[] = [];
  let cursor: string | null = null;
  for (let requestIndex = 0; requestIndex < 50; requestIndex++) {
    input.beforeRequest?.(requestIndex);
    const query = new URLSearchParams();
    if (input.since !== undefined) query.set("since", input.since);
    if (cursor !== null) query.set("cursor", cursor);
    const run = await requestSource({
      url: `${sourceUrl}?${query}`,
      dotypos: input.store.listCustomerChanges,
    });
    expect(run.response.status).toBe(200);
    const page = await readPage(run.response);
    rows.push(...page.results);
    selections.push(
      ...run.listRequests.map(
        ({ selection, page: number }) => `${selection._tag}:${number}`
      )
    );
    cursor = page.next_cursor;
    if (cursor === null) return { rows, selections };
  }
  throw new Error("The sync didn't finish within 50 pages.");
};

const exportedIds = (rows: readonly ExportedRow[]) =>
  [...new Set(rows.map(({ id }) => `${id}`))].sort(
    (left, right) => Number(left) - Number(right)
  );

const idsFromOne = (count: number) =>
  Array.from({ length: count }, (_, index) => `${index + 1}`);

describe("Dotypos customer source", () => {
  test("answers 404 without reading Dotypos while disabled", async () => {
    const { response, calls } = await requestSource({ token: null });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(calls).toEqual([]);
  });

  for (const [name, authorization] of [
    ["a missing token", null],
    ["a wrong token", `Bearer ${sourceToken}x`],
    ["a non-bearer scheme", `Basic ${sourceToken}`],
  ] as const) {
    test(`answers 401 without reading Dotypos for ${name}`, async () => {
      const { response, calls } = await requestSource({ authorization });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(calls).toEqual([]);
    });
  }

  for (const query of [
    "since=not-a-date",
    "cursor=12.x",
    "cursor=",
    "cursor=at.1759320000000.0",
    "cursor=undated.1.x",
    "cursor=from.",
  ]) {
    test(`answers 400 without reading Dotypos for ${query}`, async () => {
      const { response, calls } = await requestSource({
        url: `${sourceUrl}?${query}`,
      });

      expect(response.status).toBe(400);
      expect(calls).toEqual([]);
    });
  }

  test("exports only the allowlisted customer fields", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([customer()]),
    });
    const body = await response.clone().text();
    const page = await readPage(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Object.keys(page.results[0] ?? {}).sort()).toEqual(
      [...exportedFields].sort()
    );
    expect(page.results[0]).toEqual({
      id: "1001",
      firstName: "Ada",
      lastName: "Synthetic",
      companyName: "Synthetic Studio",
      email: testEmailAddress("ada"),
      phone: "+420000000000",
      addressLine1: "Example Street 1",
      addressLine2: "Floor 2",
      city: "Example City",
      zip: "00000",
      country: "CZ",
      birthday: "1990-01-01T00:00:00.000Z",
      _discountGroupId: "3001",
      points: "12",
      tags: ["member"],
      created: "2026-01-01T00:00:00.000Z",
      versionDate: "2026-10-01T12:00:00.000Z",
      deleted: false,
    });
    expect(body).not.toContain(excludedValueMarker);
    expect(body).not.toContain("4001");
    expect(body).not.toContain("2001");
  });

  test("exports deleted customers with the deleted flag", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([customer({ deleted: true })]),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([{ id: "1001", deleted: true }]);
  });

  test("fills absent fields with null and normalizes the version date", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([
        customer({
          lastName: undefined,
          tags: undefined,
          versionDate: "2026-10-01T14:00:00.000+02:00",
        }),
      ]),
    });
    const page = await readPage(response);

    expect(page.results[0]).toMatchObject({
      lastName: null,
      tags: null,
      versionDate: "2026-10-01T12:00:00.000Z",
    });
  });

  test("starts at PostHog's last version date and holds back the version date a full page cuts", async () => {
    const { response, listRequests } = await requestSource({
      url: `${sourceUrl}?since=${encodeURIComponent("2026-10-01T12:00:00.000000+00:00")}`,
      changes: singlePage(
        [
          customer({ id: "1", versionDate: firstVersion }),
          customer({ id: "2", versionDate: laterVersion }),
          customer({ id: "3", versionDate: laterVersion }),
        ],
        true
      ),
    });
    const page = await readPage(response);

    expect(listRequests).toHaveLength(1);
    expect(listRequests[0]?.page).toBe(1);
    expect(listRequests[0]?.selection).toMatchObject({ _tag: "ChangedFrom" });
    expect(
      listRequests[0]?.selection._tag === "ChangedFrom" &&
        DateTime.toEpochMillis(listRequests[0].selection.versionDate)
    ).toBe(epochMillis(firstVersion));
    expect(page.results.map(({ id }) => id)).toEqual(["1"]);
    expect(page.next_cursor).toBe(`from.${epochMillis(laterVersion)}`);
  });

  test("reads a version date that fills a page as a group of its own", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?cursor=from.${epochMillis(firstVersion)}`,
      changes: singlePage(customersAt(firstVersion, 100), true),
    });
    const page = await readPage(response);

    expect(page.results).toHaveLength(100);
    expect(page.next_cursor).toBe(`at.${epochMillis(firstVersion)}.1`);
  });

  test("an incremental sync exports every changed customer and no undated one", async () => {
    const store = makeDotyposStore([
      customer({ id: "1", versionDate: "2026-09-30T12:00:00.000Z" }),
      customer({ id: "2", versionDate: undefined }),
      ...customersAt(firstVersion, 150, 10),
      ...customersAt(laterVersion, 120, 200),
    ]);

    const { rows, selections } = await syncLikePostHog({
      store,
      since: firstVersion,
    });

    expect(exportedIds(rows)).toEqual(
      [
        ...customersAt(firstVersion, 150, 10),
        ...customersAt(laterVersion, 120, 200),
      ].map(({ id }) => `${id}`)
    );
    expect(
      selections.some((selection) => selection.startsWith("Undated"))
    ).toBe(false);
  });

  test("a first sync exports undated customers and then every dated one", async () => {
    const store = makeDotyposStore([
      customer({ id: "1", versionDate: undefined }),
      customer({ id: "2", versionDate: undefined }),
      ...Array.from({ length: 248 }, (_, index) =>
        customer({
          id: `${index + 3}`,
          versionDate: new Date(
            epochMillis(firstVersion) + Math.floor(index / 7) * 1000
          ).toISOString(),
        })
      ),
    ]);

    const { rows, selections } = await syncLikePostHog({ store });

    expect(selections[0]).toBe("Undated:1");
    expect(exportedIds(rows)).toEqual(idsFromOne(250));
    expect(
      rows.filter(({ versionDate }) => versionDate === null).map(({ id }) => id)
    ).toEqual(["1", "2"]);
  });

  test("keeps paging undated customers that span several pages", async () => {
    const store = makeDotyposStore(
      Array.from({ length: 230 }, (_, index) =>
        customer({ id: `${index + 1}`, versionDate: undefined })
      )
    );

    const { rows, selections } = await syncLikePostHog({ store });

    expect(selections).toEqual([
      "Undated:1",
      "Undated:2",
      "Undated:3",
      "Dated:1",
    ]);
    expect(exportedIds(rows)).toEqual(idsFromOne(230));
  });

  test("a customer edited mid-sync can't push an unread customer past the reader", async () => {
    // Review counterexample: 101 customers share a version date; after the
    // first page, customer 1 moves to a later version date.
    const store = makeDotyposStore(customersAt(firstVersion, 101));
    const editedVersion = "2026-10-01T12:00:00.001Z";

    const { rows } = await syncLikePostHog({
      store,
      since: firstVersion,
      beforeRequest: (requestIndex) => {
        if (requestIndex !== 1) return;
        store.customers[0] = customer({ id: "1", versionDate: editedVersion });
      },
    });

    expect(exportedIds(rows)).toEqual(idsFromOne(101));
    expect(rows.findLast(({ id }) => id === "1")?.versionDate).toBe(
      editedVersion
    );
  });

  test("restarts a version-date group whose count changed between its pages", async () => {
    const store = makeDotyposStore(customersAt(firstVersion, 250));
    const editedVersion = "2026-10-01T12:00:00.001Z";

    const { rows, selections } = await syncLikePostHog({
      store,
      since: firstVersion,
      beforeRequest: (requestIndex) => {
        // Requests: from-range, group page 1, then the edit before page 2.
        if (requestIndex !== 2) return;
        store.customers[4] = customer({ id: "5", versionDate: editedVersion });
      },
    });

    expect(selections).toEqual([
      "ChangedFrom:1",
      "ChangedAt:1",
      "ChangedAt:2",
      "ChangedAt:1",
      "ChangedAt:2",
      "ChangedAt:3",
      "ChangedAfter:1",
    ]);
    expect(exportedIds(rows)).toEqual(idsFromOne(250));
  });

  test("fails loudly when Dotypos doesn't count a group that spans pages", async () => {
    const store = makeDotyposStore(customersAt(firstVersion, 150), {
      counted: false,
    });

    const { response } = await requestSource({
      url: `${sourceUrl}?cursor=at.${epochMillis(firstVersion)}.1`,
      dotypos: store.listCustomerChanges,
    });

    expect(response.status).toBe(502);
  });

  test("fails loudly when Dotypos returns a customer outside the requested version dates", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${laterVersion}`,
      changes: singlePage([
        customer({ id: "1", versionDate: laterVersion }),
        customer({ id: "2", versionDate: undefined }),
      ]),
    });

    expect(response.status).toBe(502);
  });

  test("fails loudly when an undated page holds a dated customer", async () => {
    const { response } = await requestSource({
      changes: singlePage([customer({ id: "1", versionDate: firstVersion })]),
    });

    expect(response.status).toBe(502);
  });

  test("spends the export budget once before reading Dotypos", async () => {
    const { response, calls, budgetPolicies } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual(["budget", "dotypos"]);
    expect(budgetPolicies).toEqual([dotyposCustomerExportBudget]);
  });

  test("keeps Retry-After within PostHog's 300-second cap", () => {
    expect(
      Duration.toSeconds(dotyposCustomerExportBudget.window)
    ).toBeLessThanOrEqual(300);
  });

  test("answers 429 with Retry-After without reading Dotypos once the budget is spent", async () => {
    const retryAt = DateTime.add(DateTime.makeUnsafe(Date.now()), {
      seconds: 90,
    });
    const { response, calls } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      budget: Effect.succeed({ _tag: "Exhausted", retryAt }),
    });

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("90");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(calls).toEqual(["budget"]);
  });

  test("answers 503 without reading Dotypos when the budget is unavailable", async () => {
    const { response, calls } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      budget: Effect.fail(
        new RequestBudgetUnavailable({
          key: dotyposCustomerExportBudget.key,
          cause: excludedValueMarker,
        })
      ),
    });

    expect(response.status).toBe(503);
    expect(calls).toEqual(["budget"]);
  });

  test("passes a Dotypos rate limit on with a Retry-After so PostHog backs off", async () => {
    const { response, listRequests } = await requestSource({
      changes: Effect.fail(
        new ExternalAPIError({
          service: "Dotypos",
          operation: "listCustomerChanges",
          statusCode: 429,
          cause: excludedValueMarker,
        })
      ),
    });
    const body = await response.text();

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listRequests).toHaveLength(1);
    expect(body).not.toContain(excludedValueMarker);
  });

  test("answers 502 when Dotypos fails", async () => {
    const { response } = await requestSource({
      changes: Effect.fail(
        new ExternalAPIError({
          service: "Dotypos",
          operation: "listCustomerChanges",
          statusCode: 500,
        })
      ),
    });

    expect(response.status).toBe(502);
  });
});
