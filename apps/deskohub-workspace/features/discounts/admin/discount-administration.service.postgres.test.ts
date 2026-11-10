import "@/shared/testing/workspace-test-env";

import { afterAll, describe, expect, test } from "bun:test";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import {
  AdministrationCustomerDiscountCodeCreateInput,
  AdministrationCustomerVoucherCreateInput,
  AdministrationDiscountCodeCreateInput,
  AdministrationDiscountCodeUpdateInput,
  AdministrationDiscountDefinitionInput,
  AdministrationDiscountUpdateInput,
  AdministrationDotyposCustomerId,
  AdministrationVoucherCreateInput,
  AdministrationVoucherUpdateInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Layer, Option, Schema } from "effect";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { DiscountAdministration } from "./discount-administration.service";

const testDatabase = await connectWorkspacePostgresTestDatabase();

type UncheckedServiceDates = {
  readonly serviceDateFrom?: string | null;
  readonly serviceDateUntil?: string | null;
};

describe.skipIf(!testDatabase)(
  "DiscountAdministration conflicts on disposable Postgres",
  () => {
    if (!testDatabase) return;
    const labels: string[] = [];
    const codes: string[] = [];

    afterAll(async () => {
      const discountIds =
        "select id from discounts where labels->>'en-US' = any($1)";
      await testDatabase.pool.query(
        `delete from promotion_codes where id in (select promotion_code_id from discount_codes where discount_id in (${discountIds}))`,
        [labels]
      );
      await testDatabase.pool.query(
        `delete from discount_product_targets where discount_id in (${discountIds})`,
        [labels]
      );
      await testDatabase.pool.query(
        "delete from promotion_codes where code = any($1)",
        [codes]
      );
      await testDatabase.pool.query(
        "delete from discounts where labels->>'en-US' = any($1)",
        [labels]
      );
    });

    const run = <A, E>(
      operation: (
        administration: typeof DiscountAdministration.Service
      ) => Effect.Effect<A, E>,
      dotypos = DotyposServiceMock({})
    ) =>
      Effect.runPromise(
        DiscountAdministration.pipe(
          Effect.flatMap(operation),
          Effect.provide(
            DiscountAdministration.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  testDatabase.layer,
                  GoogleCalendarServiceMock({}),
                  dotypos,
                  Layer.succeed(CalendarResourceConfig, {
                    salesCalendarId: salesCalendarIdSchema.make("sales"),
                    workspaceLimitationsCalendarId:
                      workspaceLimitationsCalendarIdSchema.make("limitations"),
                  })
                )
              )
            )
          ),
          Effect.result
        )
      );

    const createDiscountCode = (code: string, label: string) =>
      run((administration) =>
        administration.createCode(
          Schema.decodeUnknownSync(AdministrationDiscountCodeCreateInput)({
            code: {
              code,
              enabled: true,
              validFrom: null,
              validUntil: null,
              maxUses: null,
            },
            discount: {
              kind: "new",
              discount: {
                labels: { "cs-CZ": label, "en-US": label },
                adjustment: { kind: "percentage", basisPoints: 1000 },
                products: [{ kind: "cowork" }],
              },
            },
          })
        )
      );

    const countDiscounts = async (label: string) =>
      (
        await testDatabase.pool.query(
          "select 1 from discounts where labels->>'en-US' = $1",
          [label]
        )
      ).rowCount;

    const uniqueSuffix = () =>
      crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase();

    test("rejects a duplicate promotion code and rolls back its new discount", async () => {
      const code = `SYNTHETIC_${uniqueSuffix()}`;
      const firstLabel = `Synthetic first ${code}`;
      const duplicateLabel = `Synthetic duplicate ${code}`;
      labels.push(firstLabel, duplicateLabel);

      expect(await createDiscountCode(code, firstLabel)).toMatchObject({
        _tag: "Success",
      });
      expect(await createDiscountCode(code, duplicateLabel)).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAdminConflictError",
          message: "A promotion code with this value already exists.",
        },
      });
      expect(await countDiscounts(duplicateLabel)).toBe(0);
    });

    test("rejects deleting a discount a code still references", async () => {
      const code = `SYNTHETIC_${uniqueSuffix()}`;
      const label = `Synthetic referenced ${code}`;
      labels.push(label);
      await createDiscountCode(code, label);
      const {
        rows: [discount],
      } = await testDatabase.pool.query<{ id: string }>(
        "select id from discounts where labels->>'en-US' = $1",
        [label]
      );
      const id = storedDiscountIdSchema.make(discount?.id ?? "");

      expect(
        await run((administration) => administration.deleteDiscount({ id }))
      ).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "DiscountAdminConflictError",
          message:
            "This discount is still referenced by a discount code and cannot be deleted.",
        },
      });
      expect(await countDiscounts(label)).toBe(1);
    });

    test("stores, keeps, replaces, and clears a code's service dates", async () => {
      const suffix = uniqueSuffix();
      const label = `Synthetic service dates ${suffix}`;
      const code = `SYNTHETIC_DATES_${suffix}`;
      const customerCode = `SYNTHETIC_DATES_CUSTOMER_${suffix}`;
      labels.push(label);
      codes.push(code, customerCode);
      const customerId = Schema.decodeUnknownSync(
        AdministrationDotyposCustomerId
      )(`synthetic-dates-${suffix}`);
      const dotypos = DotyposServiceMock({
        getCustomer: (id) =>
          Effect.succeed(Option.some({ id, deleted: false })),
      });
      const configuration = (value: string) => ({
        code: value,
        enabled: true,
        validFrom: null,
        validUntil: null,
        maxUses: null,
      });
      const serviceDates = (detail: {
        readonly code: {
          readonly serviceDateFrom: string | null;
          readonly serviceDateUntil: string | null;
        };
      }) => [detail.code.serviceDateFrom, detail.code.serviceDateUntil];

      const outcome = await run(
        Effect.fn(function* (administration) {
          const codeId = yield* administration.createCode(
            Schema.decodeUnknownSync(AdministrationDiscountCodeCreateInput)({
              code: {
                ...configuration(code),
                serviceDateFrom: "2026-07-01",
                serviceDateUntil: "2026-07-31",
              },
              discount: {
                kind: "new",
                discount: {
                  labels: { "cs-CZ": label, "en-US": label },
                  adjustment: { kind: "percentage", basisPoints: 1000 },
                  products: [{ kind: "cowork" }],
                },
              },
            })
          );
          const created = yield* administration.loadCodeDetail({ codeId });
          const customerCodeId = yield* administration.createCustomerCode(
            Schema.decodeUnknownSync(
              AdministrationCustomerDiscountCodeCreateInput
            )({
              customerId,
              code: {
                ...configuration(customerCode),
                serviceDateFrom: "2026-07-15",
                serviceDateUntil: "2026-07-15",
              },
              discount: {
                kind: "existing",
                discountId: created.code.discountId,
              },
            })
          );
          const customerCreated = yield* administration.loadCodeDetail({
            codeId: customerCodeId,
          });
          const update = (dates: UncheckedServiceDates) =>
            administration.updateCode(
              Schema.decodeUnknownSync(AdministrationDiscountCodeUpdateInput)({
                id: codeId,
                discountId: created.code.discountId,
                ...configuration(code),
                ...dates,
              })
            );
          yield* update({});
          const kept = yield* administration.loadCodeDetail({ codeId });
          yield* update({
            serviceDateFrom: "2026-08-01",
            serviceDateUntil: "2026-08-02",
          });
          const replaced = yield* administration.loadCodeDetail({ codeId });
          yield* update({ serviceDateFrom: null, serviceDateUntil: null });
          const cleared = yield* administration.loadCodeDetail({ codeId });
          yield* administration.deleteCode({ id: codeId });
          yield* administration.deleteCode({ id: customerCodeId });
          return {
            created: serviceDates(created),
            customerCreated: serviceDates(customerCreated),
            kept: serviceDates(kept),
            replaced: serviceDates(replaced),
            cleared: serviceDates(cleared),
          };
        }),
        dotypos
      );

      expect(outcome).toMatchObject({
        _tag: "Success",
        success: {
          created: ["2026-07-01", "2026-07-31"],
          customerCreated: ["2026-07-15", "2026-07-15"],
          kept: ["2026-07-01", "2026-07-31"],
          replaced: ["2026-08-01", "2026-08-02"],
          cleared: [null, null],
        },
      });
    });

    test("rejects service dates the contract would refuse without writing", async () => {
      const suffix = uniqueSuffix();
      const label = `Synthetic invalid service dates ${suffix}`;
      const code = `SYNTHETIC_BAD_DATES_${suffix}`;
      // The label cleanup removes this code with its discount.
      labels.push(label);
      await createDiscountCode(code, label);
      const {
        rows: [stored],
      } = await testDatabase.pool.query<{ id: string; discount_id: string }>(
        "select discount_codes.id, discount_codes.discount_id from discount_codes join promotion_codes on promotion_codes.id = discount_codes.promotion_code_id where promotion_codes.code = $1",
        [code]
      );
      const configuration = {
        code,
        enabled: true,
        validFrom: null,
        validUntil: null,
        maxUses: null,
      };
      type UpdateInput = Parameters<
        typeof DiscountAdministration.Service.updateCode
      >[0];
      type CreateInput = Parameters<
        typeof DiscountAdministration.Service.createCode
      >[0];
      // Skip the contract to prove the service enforces the same rule.
      const uncheckedUpdate = (dates: UncheckedServiceDates) =>
        ({
          id: stored?.id,
          discountId: stored?.discount_id,
          ...configuration,
          ...dates,
        }) as UpdateInput;
      const uncheckedCreate = (dates: UncheckedServiceDates) =>
        ({
          code: {
            ...configuration,
            code: `SYNTHETIC_UNWRITTEN_${suffix}`,
            ...dates,
          },
          discount: { kind: "existing", discountId: stored?.discount_id },
        }) as CreateInput;

      for (const dates of [
        { serviceDateFrom: "2026-07-01" },
        { serviceDateFrom: "2026-07-01", serviceDateUntil: null },
        { serviceDateFrom: "2026-07-31", serviceDateUntil: "2026-07-01" },
        { serviceDateFrom: "2026-7-1", serviceDateUntil: "2026-07-31" },
      ] satisfies UncheckedServiceDates[]) {
        expect(
          await run((administration) =>
            administration.updateCode(uncheckedUpdate(dates))
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountAdminServiceDatesError" },
        });
        expect(
          await run((administration) =>
            administration.createCode(uncheckedCreate(dates))
          )
        ).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "DiscountAdminServiceDatesError" },
        });
      }

      const {
        rows: [after],
      } = await testDatabase.pool.query<{
        service_date_from: string | null;
        service_date_until: string | null;
      }>(
        "select service_date_from, service_date_until from discount_codes where id = $1",
        [stored?.id]
      );
      expect(after).toEqual({
        service_date_from: null,
        service_date_until: null,
      });
      expect(
        (
          await testDatabase.pool.query(
            "select 1 from promotion_codes where code = $1",
            [`SYNTHETIC_UNWRITTEN_${suffix}`]
          )
        ).rowCount
      ).toBe(0);
    });

    test("runs every mutation on the Workspace transaction scope", async () => {
      const suffix = uniqueSuffix();
      const label = `Synthetic scope ${suffix}`;
      const [code, customerCode, voucherCode, customerVoucherCode] = [
        "CODE",
        "CUSTOMER_CODE",
        "VOUCHER",
        "CUSTOMER_VOUCHER",
      ].map((kind) => `SYNTHETIC_${kind}_${suffix}`) as [
        string,
        string,
        string,
        string,
      ];
      labels.push(label);
      codes.push(code, customerCode, voucherCode, customerVoucherCode);
      const [first, second] = ["first", "second"].map((name) =>
        Schema.decodeUnknownSync(AdministrationDotyposCustomerId)(
          `synthetic-${name}-${suffix}`
        )
      ) as [
        typeof AdministrationDotyposCustomerId.Type,
        typeof AdministrationDotyposCustomerId.Type,
      ];
      const dotypos = DotyposServiceMock({
        getCustomer: (id) =>
          Effect.succeed(Option.some({ id, deleted: false })),
      });
      const definition = (basisPoints: number) => ({
        labels: { "cs-CZ": label, "en-US": label },
        adjustment: { kind: "percentage", basisPoints },
        products: [{ kind: "cowork" }],
      });
      const configuration = (value: string) => ({
        code: value,
        enabled: true,
        validFrom: null,
        validUntil: null,
      });
      const credit = (value: number) => ({
        value,
        exponent: 2,
        currency: "CZK",
      });
      // The resolved customer list and the read model's audience ids agree.
      const audience = (detail: {
        readonly customers: readonly { readonly customerId: string }[];
        readonly code?: { readonly audienceCustomerIds: readonly string[] };
        readonly voucher?: { readonly audienceCustomerIds: readonly string[] };
      }) => ({
        customers: detail.customers.map(({ customerId }) => customerId),
        audienceCustomerIds: (detail.code ?? detail.voucher)
          ?.audienceCustomerIds,
      });

      const outcome = await run(
        Effect.fn(function* (administration) {
          const discountId = yield* administration.createDiscount(
            Schema.decodeUnknownSync(AdministrationDiscountDefinitionInput)(
              definition(1000)
            )
          );
          yield* administration.updateDiscount(
            Schema.decodeUnknownSync(AdministrationDiscountUpdateInput)({
              id: discountId,
              ...definition(1500),
            })
          );
          const { discounts } = yield* administration.loadCodesPage();
          const updatedDiscount = discounts.find(({ id }) => id === discountId);
          const codeId = yield* administration.createCode(
            Schema.decodeUnknownSync(AdministrationDiscountCodeCreateInput)({
              code: { ...configuration(code), maxUses: null },
              discount: { kind: "existing", discountId },
            })
          );
          const customerCodeId = yield* administration.createCustomerCode(
            Schema.decodeUnknownSync(
              AdministrationCustomerDiscountCodeCreateInput
            )({
              customerId: first,
              code: { ...configuration(customerCode), maxUses: null },
              discount: { kind: "existing", discountId },
            })
          );
          yield* administration.updateCode(
            Schema.decodeUnknownSync(AdministrationDiscountCodeUpdateInput)({
              id: codeId,
              discountId,
              ...configuration(code),
              maxUses: 3,
            })
          );
          yield* administration.addCodeCustomer({
            codeId: customerCodeId,
            customerId: second,
          });
          yield* administration.removeCodeCustomer({
            codeId: customerCodeId,
            customerId: first,
          });
          const narrowedCode = yield* administration.loadCodeDetail({
            codeId: customerCodeId,
          });
          yield* administration.makeCodeUnrestricted({
            codeId: customerCodeId,
          });
          const unrestrictedCode = yield* administration.loadCodeDetail({
            codeId: customerCodeId,
          });
          const updatedCode = yield* administration.loadCodeDetail({ codeId });
          yield* administration.deleteCode({ id: codeId });
          yield* administration.deleteCode({ id: customerCodeId });

          const voucherId = yield* administration.createVoucher(
            Schema.decodeUnknownSync(AdministrationVoucherCreateInput)({
              ...configuration(voucherCode),
              credit: credit(50_000),
            })
          );
          const customerVoucherId = yield* administration.createCustomerVoucher(
            Schema.decodeUnknownSync(AdministrationCustomerVoucherCreateInput)({
              customerId: first,
              ...configuration(customerVoucherCode),
              credit: credit(20_000),
            })
          );
          yield* administration.updateVoucher(
            Schema.decodeUnknownSync(AdministrationVoucherUpdateInput)({
              id: voucherId,
              ...configuration(voucherCode),
              credit: credit(60_000),
            })
          );
          yield* administration.addVoucherCustomer({
            voucherId: customerVoucherId,
            customerId: second,
          });
          yield* administration.removeVoucherCustomer({
            voucherId: customerVoucherId,
            customerId: first,
          });
          const narrowedVoucher = yield* administration.loadVoucherDetail({
            voucherId: customerVoucherId,
          });
          yield* administration.makeVoucherUnrestricted({
            voucherId: customerVoucherId,
          });
          const unrestrictedVoucher = yield* administration.loadVoucherDetail({
            voucherId: customerVoucherId,
          });
          const updatedVoucher = yield* administration.loadVoucherDetail({
            voucherId,
          });
          yield* administration.deleteVoucher({ id: voucherId });
          yield* administration.deleteVoucher({ id: customerVoucherId });
          yield* administration.deleteDiscount({ id: discountId });

          return {
            narrowedCode: audience(narrowedCode),
            unrestrictedCode: audience(unrestrictedCode),
            updatedAdjustment: updatedDiscount?.adjustment,
            updatedCodeMaxUses: updatedCode.code.maxUses,
            narrowedVoucher: audience(narrowedVoucher),
            unrestrictedVoucher: audience(unrestrictedVoucher),
            updatedVoucherCredit: updatedVoucher.voucher.issuedCredit.value,
          };
        }),
        dotypos
      );

      expect(outcome).toMatchObject({
        _tag: "Success",
        success: {
          narrowedCode: { customers: [second], audienceCustomerIds: [second] },
          unrestrictedCode: { customers: [], audienceCustomerIds: [] },
          updatedAdjustment: { kind: "percentage", basisPoints: 1500 },
          updatedCodeMaxUses: 3,
          narrowedVoucher: {
            customers: [second],
            audienceCustomerIds: [second],
          },
          unrestrictedVoucher: { customers: [], audienceCustomerIds: [] },
          updatedVoucherCredit: 60_000,
        },
      });
      expect(await countDiscounts(label)).toBe(0);
      expect(
        (
          await testDatabase.pool.query(
            "select 1 from promotion_codes where code = any($1)",
            [codes]
          )
        ).rowCount
      ).toBe(0);
    });
  }
);
