import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type EmailCustomerField,
  type EmailCustomerSelection,
  type EmailValueDefinition,
  EmailValueName,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  selectedEmailCustomerShape as selectedEmailCustomerFields,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Schema } from "effect";
import {
  CustomerValueSource,
  CustomerValueUnavailable,
} from "./customer-value-source.service";
import { CustomerValues } from "./customer-values.service";

const definition = (
  source: typeof EmailCustomerSelection.Type
): EmailValueDefinition & { source: typeof EmailCustomerSelection.Type } => {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    source.path,
    { inheritPresence: false }
  );
  const sort =
    source.sort && selected?.kind === "list"
      ? emailCustomerFieldAtPath(selected.element, source.sort.path)
      : undefined;
  return {
    name: Schema.decodeUnknownSync(EmailValueName)("synthetic_value"),
    source,
    customerShape: selectedEmailCustomerFields(source),
    customerSortShape: sort,
  };
};
const profile = {
  customer: { email: testEmailAddress("selected-value"), phone: null },
  codes: [
    { code: "SYNTHETIC_OLD", createdAt: "2026-01-01", internal: "excluded" },
    { code: "SYNTHETIC_NEW", createdAt: "2026-10-01", internal: "excluded" },
    { code: "SYNTHETIC_TIE", createdAt: "2026-10-01", internal: "excluded" },
  ],
  discountGroups: [
    { id: "synthetic-group", basisPoints: 1000, name: "Synthetic" },
  ],
};
const run = (input: {
  readonly definition: ReturnType<typeof definition>;
  readonly profile?: unknown;
  readonly activity?: unknown;
  readonly fail?: boolean;
  readonly called?: () => void;
}) =>
  Effect.flatMap(CustomerValues, (values) =>
    values.resolve({
      customerId: "synthetic-customer",
      definition: input.definition,
      locale: "en-US",
    })
  ).pipe(
    Effect.provide(
      CustomerValues.Default.pipe(
        Layer.provide(
          Layer.mock(CustomerValueSource, {
            profile: () => {
              input.called?.();
              return input.fail
                ? Effect.fail(
                    new CustomerValueUnavailable({ source: "profile" })
                  )
                : Effect.succeed(input.profile ?? profile);
            },
            activity: () =>
              Effect.succeed(input.activity ?? { marketingConsent: null }),
          } as never)
        )
      )
    ),
    Effect.result,
    Effect.runPromise
  );

describe("CustomerValues", () => {
  test("resolves an explicitly selected sensitive scalar", async () => {
    expect(
      await run({
        definition: definition({
          kind: "customer",
          path: ["profile", "customer", "email"],
        }),
      })
    ).toMatchObject({
      _tag: "Success",
      success: testEmailAddress("selected-value"),
    });
  });
  test("projects selected record fields and preserves nested nulls", async () => {
    expect(
      await run({
        definition: definition({
          kind: "customer",
          path: ["profile", "customer"],
          fields: [["email"], ["phone"]],
        }),
      })
    ).toMatchObject({
      _tag: "Success",
      success: { email: testEmailAddress("selected-value"), phone: null },
    });
  });
  test("sorts before projecting and limiting while retaining stable ties", async () => {
    const result = await run({
      definition: definition({
        kind: "customer",
        path: ["profile", "codes"],
        fields: [["code"]],
        sort: { path: ["createdAt"], direction: "desc" },
        limit: 2,
      }),
    });
    expect(result).toMatchObject({
      _tag: "Success",
      success: [{ code: "SYNTHETIC_NEW" }, { code: "SYNTHETIC_TIE" }],
    });
  });
  test("sorts numeric data numerically and accepts empty lists", async () => {
    const selected = definition({
      kind: "customer",
      path: ["profile", "discountGroups"],
      fields: [["name"]],
      sort: { path: ["basisPoints"], direction: "asc" },
    });
    expect(
      await run({
        definition: selected,
        profile: {
          discountGroups: [
            { name: "large", basisPoints: 1000 },
            { name: "small", basisPoints: 25 },
          ],
        },
      })
    ).toMatchObject({
      _tag: "Success",
      success: [{ name: "small" }, { name: "large" }],
    });
    expect(
      await run({ definition: selected, profile: { discountGroups: [] } })
    ).toMatchObject({ _tag: "Success", success: [] });
  });
  test("orders mixed sort data by type, booleans first and strings last", async () => {
    expect(
      await run({
        definition: definition({
          kind: "customer",
          path: ["profile", "codes"],
          fields: [["code"]],
          sort: { path: ["createdAt"], direction: "asc" },
        }),
        profile: {
          codes: [
            { code: "string", createdAt: "2026-01-01" },
            { code: "five", createdAt: 5 },
            { code: "true", createdAt: true },
            { code: "three", createdAt: 3 },
            { code: "false", createdAt: false },
          ],
        },
      })
    ).toMatchObject({
      _tag: "Success",
      success: [
        { code: "false" },
        { code: "true" },
        { code: "three" },
        { code: "five" },
        { code: "string" },
      ],
    });
  });
  test("keeps null sort keys last in either direction", async () => {
    for (const direction of ["asc", "desc"] as const) {
      const selected = definition({
        kind: "customer",
        path: ["profile", "codes"],
        fields: [["code"]],
        sort: { path: ["validUntil"], direction },
      });
      expect(
        await run({
          definition: selected,
          profile: {
            codes: [
              { code: "null", validUntil: null },
              { code: "date", validUntil: "2026-01-01" },
            ],
          },
        })
      ).toMatchObject({
        _tag: "Success",
        success: [{ code: "date" }, { code: "null" }],
      });
    }
  });
  test("keeps absent top-level data distinct from temporary source failures", async () => {
    const selected = definition({
      kind: "customer",
      path: ["activity", "marketingConsent"],
      fields: [["locale"]],
    });
    expect(await run({ definition: selected })).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerValueMissing", reason: "field-absent" },
    });
    expect(
      await run({
        definition: definition({
          kind: "customer",
          path: ["profile", "customer", "email"],
        }),
        fail: true,
      })
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerValueUnavailable" },
    });
  });
  test("rejects shape drift before absence and does not hide it behind fallback", async () => {
    const selected = definition({
      kind: "customer",
      path: ["activity", "marketingConsent"],
      fields: [["locale"]],
    });
    const changed: EmailCustomerField = {
      kind: "scalar",
      type: "number",
      nullable: false,
      optional: false,
    };
    expect(
      await run({
        definition: {
          ...selected,
          customerShape: changed,
          fallback: { "en-US": "Unavailable" },
        },
      })
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerValueRejected", reason: "incompatible-shape" },
    });
  });
  test("rejects missing or changed historical sort-only types before lookup", async () => {
    const selected = definition({
      kind: "customer",
      path: ["profile", "codes"],
      fields: [["code"]],
      sort: { path: ["createdAt"], direction: "asc" },
    });
    let called = false;
    for (const shape of [
      undefined,
      { kind: "scalar", type: "number", nullable: false, optional: false },
    ] as const) {
      expect(
        await run({
          definition: { ...selected, customerSortShape: shape },
          called: () => {
            called = true;
          },
        })
      ).toMatchObject({
        _tag: "Failure",
        failure: { _tag: "CustomerValueRejected", reason: "incompatible-sort" },
      });
    }
    expect(called).toBe(false);
  });
  test("reads a nested list without flattening it", async () => {
    const selected = definition({
      kind: "customer",
      path: ["activity", "stats", "revenue"],
      fields: [["value"], ["currency"]],
    });
    expect(
      await run({
        definition: selected,
        activity: {
          stats: { revenue: [{ value: 2500, currency: "CZK", exponent: 2 }] },
        },
      })
    ).toMatchObject({
      _tag: "Success",
      success: [{ value: 2500, currency: "CZK" }],
    });
  });
  test("uses an already frozen projected sort field on a historical definition", async () => {
    const selected = definition({
      kind: "customer",
      path: ["profile", "codes"],
      fields: [["code"], ["createdAt"]],
      sort: { path: ["createdAt"], direction: "desc" },
      limit: 1,
    });
    expect(
      await run({ definition: { ...selected, customerSortShape: undefined } })
    ).toMatchObject({
      _tag: "Success",
      success: [{ code: "SYNTHETIC_NEW", createdAt: "2026-10-01" }],
    });
  });

  test("rejects non-scalar sorting and invalid paths without lookup", async () => {
    let calls = 0;
    const invalid = definition({
      kind: "customer",
      path: ["profile", "codes"],
      fields: [["code"]],
      sort: { path: ["missing"], direction: "asc" },
    });
    expect(
      await run({
        definition: invalid,
        called: () => {
          calls++;
        },
      })
    ).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "EmailCustomerSelectionInvalid",
        reason: "invalid-sort",
      },
    });
    expect(calls).toBe(0);
  });
  test("rejects invalid scalar runtime data and never returns extra fields", async () => {
    const selected = definition({
      kind: "customer",
      path: ["profile", "codes"],
      fields: [["code"]],
      sort: { path: ["createdAt"], direction: "asc" },
    });
    expect(
      await run({
        definition: selected,
        profile: { codes: [{ code: 123, createdAt: "2026-01-01" }] },
      })
    ).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "CustomerValueRejected" },
    });
  });
});
