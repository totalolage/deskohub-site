import { describe, expect, test } from "bun:test";
import {
  type CustomerChanges,
  type CustomerChangesOptions,
  CustomerVersionSelection,
  type DotyposCustomer,
  DotyposCustomerSchema,
  DotyposTimestampFromString,
  ExternalAPIError,
  formatDotyposTimestamp,
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
): Effect.Effect<CustomerChanges> => Effect.succeed({ customers, hasMore });

const readPage = async (response: Response) =>
  (await response.json()) as {
    readonly results: readonly ExportedRow[];
    readonly next_cursor: string | null;
  };

const timestampOf = Schema.decodeSync(DotyposTimestampFromString);

/** A Dotypos timestamp in the epoch microseconds cursors carry. */
const micros = (iso: string) => `${timestampOf(iso)}`;

const firstVersion = "2026-10-01T12:00:00.000Z";
const laterVersion = "2026-10-01T12:05:00.000Z";
const firstCreated = timestampOf("2026-01-01T00:00:00.000Z");

const optionalTimestamp = (value: string | null | undefined) =>
  value === null || value === undefined ? undefined : timestampOf(value);

/**
 * A synthetic Dotypos customer list that filters at microsecond precision and
 * serves the first page of 100 like the customer list endpoint. Tests edit
 * `customers` between requests. Customers that tie on the sort key come back
 * in a different order on every request, as Dotypos doesn't promise one.
 */
const makeDotyposStore = (customers: DotyposCustomer[]) => {
  let requestCount = 0;
  const listCustomerChanges: ListCustomerChanges = ({ selection }) => {
    requestCount++;
    const isAtLeast = (
      value: bigint | undefined,
      lowest: Option.Option<bigint>
    ) =>
      value !== undefined &&
      Option.match(lowest, {
        onNone: () => true,
        onSome: (bound) => value >= bound,
      });
    const matching = customers.filter((candidate) => {
      const version = optionalTimestamp(candidate.versionDate);
      const created = optionalTimestamp(candidate.created);
      return Match.valueTags(selection, {
        Dated: () => version !== undefined,
        ChangedFrom: ({ versionDate }) =>
          version !== undefined && version >= versionDate,
        ChangedAfter: ({ versionDate }) =>
          version !== undefined && version > versionDate,
        ChangedAt: ({ versionDate, createdFrom }) =>
          version === versionDate && isAtLeast(created, createdFrom),
        Undated: ({ createdFrom }) =>
          version === undefined && isAtLeast(created, createdFrom),
      });
    });
    const sortKey = (candidate: DotyposCustomer) =>
      Match.valueTags(selection, {
        Dated: () => optionalTimestamp(candidate.versionDate),
        ChangedFrom: () => optionalTimestamp(candidate.versionDate),
        ChangedAfter: () => optionalTimestamp(candidate.versionDate),
        ChangedAt: () => optionalTimestamp(candidate.created),
        Undated: () => optionalTimestamp(candidate.created),
      }) ?? BigInt(0);
    const tieOrder = requestCount % 2 === 0 ? 1 : -1;
    const ordered = matching.sort((left, right) => {
      const difference = sortKey(left) - sortKey(right);
      return difference === BigInt(0)
        ? tieOrder * (Number(left.id) - Number(right.id))
        : Number(difference);
    });
    return Effect.succeed({
      customers: ordered.slice(0, 100),
      hasMore: ordered.length > 100,
    });
  };
  return { customers, listCustomerChanges };
};

/** Customers sharing one version date, each created a microsecond apart. */
const customersAt = (versionDate: string, count: number, firstId = 1) =>
  Array.from({ length: count }, (_, index) =>
    customer({
      id: `${firstId + index}`,
      versionDate,
      created: formatDotyposTimestamp(firstCreated + BigInt(firstId + index)),
    })
  );

const runSourceRequest = (input: {
  readonly store: ReturnType<typeof makeDotyposStore>;
  readonly since?: string;
  readonly cursor: string | null;
}) => {
  const query = new URLSearchParams();
  if (input.since !== undefined) query.set("since", input.since);
  if (input.cursor !== null) query.set("cursor", input.cursor);
  return requestSource({
    url: `${sourceUrl}?${query}`,
    dotypos: input.store.listCustomerChanges,
  });
};

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
    const run = await runSourceRequest({ ...input, cursor });
    expect(run.response.status).toBe(200);
    const page = await readPage(run.response);
    rows.push(...page.results);
    selections.push(...run.listRequests.map(({ selection }) => selection._tag));
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

const idsOf = (customers: readonly DotyposCustomer[]) =>
  customers.map(({ id }) => `${id}`);

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
    "cursor=at.x",
    "cursor=at.1759320000000.1.100",
    "cursor=undated.1.2",
    "cursor=from.",
    "cursor=from.12345678901234567",
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
      versionDate: "2026-10-01T12:00:00.000000Z",
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

  test("blanks an opted-out customer and keeps its identity timestamps", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([customer({ tags: ["member", "no-analytics"] })]),
    });
    const page = await readPage(response);

    expect(response.status).toBe(200);
    expect(page.results).toEqual([
      {
        id: "1001",
        firstName: null,
        lastName: null,
        companyName: null,
        email: null,
        phone: null,
        addressLine1: null,
        addressLine2: null,
        city: null,
        zip: null,
        country: null,
        birthday: null,
        _discountGroupId: null,
        points: null,
        tags: null,
        created: "2026-01-01T00:00:00.000Z",
        versionDate: "2026-10-01T12:00:00.000000Z",
        deleted: true,
      },
    ]);
  });

  test("matches the opt-out tag without case or surrounding whitespace", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([customer({ tags: ["member", " No-Analytics "] })]),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([
      { id: "1001", firstName: null, email: null, tags: null, deleted: true },
    ]);
  });

  test("leaves a customer without the opt-out tag unchanged", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([customer({ tags: ["member"] })]),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([
      {
        id: "1001",
        firstName: "Ada",
        email: testEmailAddress("ada"),
        tags: ["member"],
        deleted: false,
      },
    ]);
  });

  test("fills absent fields with null and keeps the version date to the microsecond in UTC", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage([
        customer({
          id: "1",
          lastName: undefined,
          tags: undefined,
          versionDate: "2026-10-01T14:00:00.000+02:00",
        }),
        customer({ id: "2", versionDate: "2026-10-01T12:00:00.74702Z" }),
      ]),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([
      {
        lastName: null,
        tags: null,
        versionDate: "2026-10-01T12:00:00.000000Z",
      },
      { versionDate: "2026-10-01T12:00:00.747020Z" },
    ]);
  });

  test("treats an explicitly null version date as undated", async () => {
    const { response } = await requestSource({
      changes: singlePage([
        customer({ id: "1", versionDate: null }),
        customer({ id: "2", versionDate: undefined }),
      ]),
    });
    const page = await readPage(response);

    expect(response.status).toBe(200);
    expect(page.results).toMatchObject([
      { id: "1", versionDate: null },
      { id: "2", versionDate: null },
    ]);
    expect(page.next_cursor).toBe("dated");
  });

  test("rejects a whole page when a customer has no ID", async () => {
    const { response, listRequests } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage(
        [
          customer({ id: undefined, versionDate: firstVersion }),
          customer({ id: "2", versionDate: laterVersion }),
        ],
        true
      ),
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: "Dotypos customers are unavailable.",
    });
    expect(listRequests).toHaveLength(1);
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

    expect(listRequests).toEqual([
      {
        selection: CustomerVersionSelection.ChangedFrom({
          versionDate: timestampOf(firstVersion),
        }),
      },
    ]);
    expect(page.results.map(({ id }) => id)).toEqual(["1"]);
    expect(page.next_cursor).toBe(`from.${micros(laterVersion)}`);
  });

  test("keeps the paging cursor when serving an opted-out row", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?since=${firstVersion}`,
      changes: singlePage(
        [
          customer({
            id: "1",
            versionDate: firstVersion,
            tags: ["no-analytics"],
          }),
          customer({ id: "2", versionDate: laterVersion }),
          customer({ id: "3", versionDate: laterVersion }),
        ],
        true
      ),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([
      {
        id: "1",
        firstName: null,
        deleted: true,
        versionDate: "2026-10-01T12:00:00.000000Z",
      },
    ]);
    expect(page.next_cursor).toBe(`from.${micros(laterVersion)}`);
  });

  test("reads a version date that fills a page as a group of its own", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?cursor=from.${micros(firstVersion)}`,
      changes: singlePage(customersAt(firstVersion, 100), true),
    });
    const page = await readPage(response);

    expect(page.results).toHaveLength(100);
    expect(page.next_cursor).toBe(`at.${micros(firstVersion)}`);
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

    expect(exportedIds(rows)).toEqual([
      ...idsOf(customersAt(firstVersion, 150, 10)),
      ...idsOf(customersAt(laterVersion, 120, 200)),
    ]);
    expect(selections).not.toContain("Undated");
  });

  test("tells apart version dates within one millisecond", async () => {
    // Dotypos stores microseconds: 150 customers edited within one
    // millisecond have distinct version dates and need no group.
    const store = makeDotyposStore(
      Array.from({ length: 150 }, (_, index) =>
        customer({
          id: `${index + 1}`,
          versionDate: `2026-10-01T12:00:00.000${`${index + 1}`.padStart(3, "0")}Z`,
        })
      )
    );

    const { rows, selections } = await syncLikePostHog({
      store,
      since: firstVersion,
    });

    expect(exportedIds(rows)).toEqual(idsFromOne(150));
    expect(selections).toEqual(["ChangedFrom", "ChangedFrom"]);
  });

  test("a first sync exports undated customers and then every dated one", async () => {
    const store = makeDotyposStore([
      customer({ id: "1", versionDate: undefined }),
      customer({ id: "2", versionDate: null }),
      ...Array.from({ length: 248 }, (_, index) =>
        customer({
          id: `${index + 3}`,
          versionDate: new Date(
            Date.parse(firstVersion) + Math.floor(index / 7) * 1000
          ).toISOString(),
        })
      ),
    ]);

    const { rows, selections } = await syncLikePostHog({ store });

    expect(selections[0]).toBe("Undated");
    expect(exportedIds(rows)).toEqual(idsFromOne(250));
    expect(
      exportedIds(rows.filter(({ versionDate }) => versionDate === null))
    ).toEqual(["1", "2"]);
  });

  test("keeps paging undated customers that span several pages", async () => {
    const store = makeDotyposStore(
      customersAt(firstVersion, 230).map((undated) =>
        customer({ ...undated, versionDate: undefined })
      )
    );

    const { rows, selections } = await syncLikePostHog({ store });

    expect(selections).toEqual(["Undated", "Undated", "Undated", "Dated"]);
    expect(exportedIds(rows)).toEqual(idsFromOne(230));
  });

  test("a customer edited mid-sync can't push an unread customer past the reader", async () => {
    // Review counterexample: 101 customers share a version date; after the
    // first page, customer 1 moves to a later version date.
    const store = makeDotyposStore(customersAt(firstVersion, 101));
    const editedVersion = "2026-10-01T12:00:00.000001Z";

    const { rows } = await syncLikePostHog({
      store,
      since: firstVersion,
      beforeRequest: (requestIndex) => {
        if (requestIndex !== 1) return;
        store.customers[0] = customer({
          ...store.customers[0],
          versionDate: editedVersion,
        });
      },
    });

    expect(exportedIds(rows)).toEqual(idsFromOne(101));
    expect(rows.findLast(({ id }) => id === "1")?.versionDate).toBe(
      editedVersion
    );
  });

  test("a version-date group edited between its pages loses no customer", async () => {
    const store = makeDotyposStore(customersAt(firstVersion, 250));
    const editedVersion = "2026-10-01T12:00:00.000001Z";

    const { rows, selections } = await syncLikePostHog({
      store,
      since: firstVersion,
      beforeRequest: (requestIndex) => {
        // Requests: from-range, then group pages; edit an already-read and
        // an unread customer before the second group page.
        if (requestIndex !== 2) return;
        for (const index of [4, 180]) {
          store.customers[index] = customer({
            ...store.customers[index],
            versionDate: editedVersion,
          });
        }
      },
    });

    expect(selections).toEqual([
      "ChangedFrom",
      "ChangedAt",
      "ChangedAt",
      "ChangedAt",
      "ChangedAfter",
    ]);
    expect(exportedIds(rows)).toEqual(idsFromOne(250));
    expect(rows.findLast(({ id }) => id === "181")?.versionDate).toBe(
      editedVersion
    );
  });

  test("fails instead of skipping when Dotypos repeats a group page", async () => {
    // Review counterexample: a 250-customer group whose pages came back as
    // customers 1-100, 1-100 again, then 201-250. Paging by number served 200
    // rows and dropped 101-200 for good.
    const group = customersAt(firstVersion, 250);
    const replies = [
      group.slice(0, 100),
      group.slice(0, 100),
      group.slice(200),
    ];
    const store = {
      customers: group,
      listCustomerChanges: () =>
        singlePage(replies.shift() ?? [], replies.length > 0),
    };

    const first = await runSourceRequest({
      store,
      cursor: `at.${micros(firstVersion)}`,
    });
    const firstPage = await readPage(first.response);
    const second = await runSourceRequest({
      store,
      cursor: firstPage.next_cursor,
    });

    expect(first.response.status).toBe(200);
    expect(idsOf([...firstPage.results] as DotyposCustomer[])).toEqual(
      idsFromOne(99)
    );
    expect(firstPage.next_cursor).toBe(
      `at.${micros(firstVersion)}.${firstCreated + BigInt(100)}`
    );
    expect(second.response.status).toBe(502);
    expect(second.listRequests).toEqual([
      {
        selection: CustomerVersionSelection.ChangedAt({
          versionDate: timestampOf(firstVersion),
          createdFrom: Option.some(firstCreated + BigInt(100)),
        }),
      },
    ]);
  });

  test("fails instead of guessing when a whole group page shares one creation time", async () => {
    const { response } = await requestSource({
      url: `${sourceUrl}?cursor=at.${micros(firstVersion)}`,
      changes: singlePage(
        Array.from({ length: 100 }, (_, index) =>
          customer({ id: `${index + 1}`, versionDate: firstVersion })
        ),
        true
      ),
    });

    expect(response.status).toBe(502);
  });

  for (const [name, url, customers, hasMore] of [
    [
      "an undated customer on a dated page",
      `${sourceUrl}?since=${laterVersion}`,
      [
        customer({ id: "1", versionDate: laterVersion }),
        customer({ id: "2", versionDate: null }),
      ],
      false,
    ],
    [
      "a dated customer on an undated page",
      sourceUrl,
      [customer({ id: "1", versionDate: firstVersion })],
      false,
    ],
    [
      "a version date before the requested one",
      `${sourceUrl}?cursor=after.${micros(firstVersion)}`,
      [customer({ id: "1", versionDate: firstVersion })],
      false,
    ],
    [
      "version dates out of order",
      `${sourceUrl}?since=${firstVersion}`,
      [
        customer({ id: "1", versionDate: laterVersion }),
        customer({ id: "2", versionDate: firstVersion }),
      ],
      true,
    ],
    [
      "a group customer of another version date",
      `${sourceUrl}?cursor=at.${micros(firstVersion)}`,
      [customer({ id: "1", versionDate: laterVersion })],
      false,
    ],
    [
      "group creation times out of order",
      `${sourceUrl}?cursor=at.${micros(firstVersion)}`,
      [...customersAt(firstVersion, 2)].reverse(),
      false,
    ],
    [
      "a group creation time before the requested one",
      `${sourceUrl}?cursor=at.${micros(firstVersion)}.${firstCreated + BigInt(2)}`,
      customersAt(firstVersion, 2),
      false,
    ],
    [
      "a group customer without a creation time",
      `${sourceUrl}?cursor=undated`,
      [customer({ id: "1", versionDate: null, created: null })],
      false,
    ],
    [
      "an unreadable version date",
      `${sourceUrl}?since=${firstVersion}`,
      [customer({ id: "1", versionDate: "2026-10-01 12:00:00" })],
      false,
    ],
    [
      "an empty page that claims more follow",
      `${sourceUrl}?since=${firstVersion}`,
      [],
      true,
    ],
  ] as const) {
    test(`answers 502 for ${name}`, async () => {
      const { response } = await requestSource({
        url,
        changes: singlePage(customers, hasMore),
      });

      expect(response.status).toBe(502);
    });
  }

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
