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
      const audience = (detail: {
        readonly customers: readonly { readonly customerId: string }[];
      }) => detail.customers.map(({ customerId }) => customerId);

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
          narrowedCode: [second],
          unrestrictedCode: [],
          updatedAdjustment: { kind: "percentage", basisPoints: 1500 },
          updatedCodeMaxUses: 3,
          narrowedVoucher: [second],
          unrestrictedVoucher: [],
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
