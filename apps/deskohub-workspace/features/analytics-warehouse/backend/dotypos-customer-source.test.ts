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
import { DateTime, Effect, Layer, Option, Redacted, Schema } from "effect";
import { respondWithDotyposCustomerSource } from "./dotypos-customer-source";
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
};

const requestSource = async (input: {
  readonly url?: string;
  readonly authorization?: string | null;
  readonly token?: string | null;
  readonly changes?: Effect.Effect<CustomerChanges, ExternalAPIError>;
}): Promise<SourceRun> => {
  const listRequests: CustomerChangesOptions[] = [];
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
          DotyposServiceMock({
            listCustomerChanges: (options: CustomerChangesOptions) => {
              listRequests.push(options);
              return (
                input.changes ??
                Effect.succeed({ customers: [], hasMore: false })
              );
            },
          })
        )
      )
    )
  );
  return { response, listRequests };
};

const readPage = async (response: Response) =>
  (await response.json()) as {
    readonly results: readonly ExportedRow[];
    readonly next_cursor: string | null;
  };

const epochMillis = (iso: string) =>
  DateTime.toEpochMillis(DateTime.makeUnsafe(iso));

describe("Dotypos customer source", () => {
  test("answers 404 without reading Dotypos while disabled", async () => {
    const { response, listRequests } = await requestSource({ token: null });

    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(listRequests).toEqual([]);
  });

  for (const [name, authorization] of [
    ["a missing token", null],
    ["a wrong token", `Bearer ${sourceToken}x`],
    ["a non-bearer scheme", `Basic ${sourceToken}`],
  ] as const) {
    test(`answers 401 without reading Dotypos for ${name}`, async () => {
      const { response, listRequests } = await requestSource({
        authorization,
      });

      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toBe("Bearer");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      expect(listRequests).toEqual([]);
    });
  }

  for (const query of ["since=not-a-date", "cursor=12.x", "cursor="]) {
    test(`answers 400 without reading Dotypos for ${query}`, async () => {
      const { response, listRequests } = await requestSource({
        url: `${sourceUrl}?${query}`,
      });

      expect(response.status).toBe(400);
      expect(listRequests).toEqual([]);
    });
  }

  test("exports only the allowlisted customer fields", async () => {
    const { response } = await requestSource({
      changes: Effect.succeed({ customers: [customer()], hasMore: false }),
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
      changes: Effect.succeed({
        customers: [customer({ deleted: true })],
        hasMore: false,
      }),
    });
    const page = await readPage(response);

    expect(page.results).toMatchObject([{ id: "1001", deleted: true }]);
  });

  test("fills absent fields with null and normalizes the version date", async () => {
    const { response } = await requestSource({
      changes: Effect.succeed({
        customers: [
          customer({
            lastName: undefined,
            tags: undefined,
            versionDate: "2026-10-01T14:00:00.000+02:00",
          }),
        ],
        hasMore: false,
      }),
    });
    const page = await readPage(response);

    expect(page.results[0]).toMatchObject({
      lastName: null,
      tags: null,
      versionDate: "2026-10-01T12:00:00.000Z",
    });
  });

  test("starts at PostHog's last version date and pages by version date", async () => {
    const first = "2026-10-01T12:00:00.000Z";
    const second = "2026-10-01T12:05:00.000Z";

    const firstRun = await requestSource({
      url: `${sourceUrl}?since=${encodeURIComponent("2026-10-01T12:00:00.000000+00:00")}`,
      changes: Effect.succeed({
        customers: [
          customer({ id: "1", versionDate: first }),
          customer({ id: "2", versionDate: second }),
          customer({ id: "3", versionDate: second }),
        ],
        hasMore: true,
      }),
    });
    const firstPage = await readPage(firstRun.response);

    expect(firstRun.listRequests).toHaveLength(1);
    expect(
      firstRun.listRequests.map(({ changedSince, skip }) => ({
        changedSince: changedSince && DateTime.toEpochMillis(changedSince),
        skip,
      }))
    ).toEqual([{ changedSince: epochMillis(first), skip: 0 }]);
    expect(firstPage.next_cursor).toBe(`${epochMillis(second)}.2`);

    const secondRun = await requestSource({
      url: `${sourceUrl}?since=${encodeURIComponent(first)}&cursor=${firstPage.next_cursor}`,
      changes: Effect.succeed({
        customers: [
          customer({ id: "4", versionDate: second }),
          customer({ id: "5", versionDate: second }),
        ],
        hasMore: true,
      }),
    });
    const secondPage = await readPage(secondRun.response);

    expect(secondRun.listRequests).toHaveLength(1);
    expect(secondRun.listRequests[0]?.skip).toBe(2);
    expect(
      secondRun.listRequests[0]?.changedSince &&
        DateTime.toEpochMillis(secondRun.listRequests[0].changedSince)
    ).toBe(epochMillis(second));
    expect(secondPage.next_cursor).toBe(`${epochMillis(second)}.4`);

    const lastRun = await requestSource({
      url: `${sourceUrl}?cursor=${secondPage.next_cursor}`,
      changes: Effect.succeed({
        customers: [customer({ id: "6", versionDate: second })],
        hasMore: false,
      }),
    });
    const lastPage = await readPage(lastRun.response);

    expect(lastRun.listRequests).toHaveLength(1);
    expect(lastRun.listRequests[0]?.skip).toBe(4);
    expect(lastPage.results.map(({ id }) => id)).toEqual(["6"]);
    expect(lastPage.next_cursor).toBeNull();
  });

  test("lists every customer on the first sync", async () => {
    const { response, listRequests } = await requestSource({
      changes: Effect.succeed({
        customers: [customer({ id: "1" })],
        hasMore: true,
      }),
    });
    const page = await readPage(response);

    expect(listRequests).toEqual([{ skip: 0 }]);
    expect(page.next_cursor).toBe(
      `${epochMillis("2026-10-01T12:00:00.000Z")}.1`
    );
  });

  test("passes a Dotypos rate limit on so PostHog backs off", async () => {
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
