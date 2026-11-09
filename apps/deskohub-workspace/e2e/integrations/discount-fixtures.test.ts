import "@/shared/polyfills/temporal";

import { expect, test } from "bun:test";
import { Effect } from "effect";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { getWorkspaceProductByTier } from "../../features/checkout/product-catalog";
import { calendarDiscountExpectation } from "../cases/discounts";
import { E2EDatabase } from "./database.service";
import {
  discountCodeFixtures,
  seedDiscountE2EFixtures,
} from "./discount-fixtures";

test("voucher credit covers two one-day Open Space checkouts after the Calendar sale", () => {
  const openSpacePrice = getWorkspaceProductByTier("open-space").price.value;
  const calendarSaleBasisPoints =
    calendarDiscountExpectation.adjustment.basisPoints;

  const perDateAfterSale =
    openSpacePrice -
    Math.floor((openSpacePrice * calendarSaleBasisPoints) / 10_000);
  expect(perDateAfterSale).toBe(
    Math.floor((openSpacePrice * (10_000 - calendarSaleBasisPoints)) / 10_000)
  );

  const expectedTwoDateTotal = perDateAfterSale * 2;
  expect(discountCodeFixtures.voucherReuse.creditPerRun.value).toBe(
    expectedTwoDateTotal
  );
});

test("seeds every fixture table with one statement in one transaction", async () => {
  const recording = await makeRecordingWorkspaceDatabase();
  const voucherReuseUsedValue = 500;
  recording.setRows([
    [],
    [],
    [],
    // An earlier run still holds two active capacity-one uses.
    [[2]],
    // Earlier runs still hold part of the reuse voucher's credit.
    [[voucherReuseUsedValue, discountCodeFixtures.voucherReuse.id]],
    [],
  ]);

  await Effect.runPromise(
    seedDiscountE2EFixtures.pipe(
      Effect.provideService(E2EDatabase, E2EDatabase.of({ db: recording.db }))
    )
  );

  expect(recording.statements.map(({ sql }) => statementShape(sql))).toEqual([
    "begin",
    "insert into discounts",
    "delete from discount_targets",
    "insert into discount_targets",
    "select from discount_code_redemptions",
    "select from voucher_redemptions",
    "insert into promotion_codes",
    "insert into discount_codes",
    "delete from promotion_code_customers",
    "insert into promotion_code_customers",
    "insert into vouchers",
    "commit",
  ]);

  const discountCodeParams = statementParams(recording, "discount_codes");
  const capacityOneOffset = discountCodeParams.indexOf(
    discountCodeFixtures.capacityOne.id
  );
  // id, code, enabled, valid_from, valid_until, promotion_code_id,
  // discount_id, max_uses
  expect(discountCodeParams[capacityOneOffset + 7]).toBe(3);

  const voucherParams = statementParams(recording, "vouchers");
  const issuedValue = (id: string) =>
    // id, promotion_code_id, issued_amount_value
    voucherParams[voucherParams.indexOf(id) + 2];
  expect(issuedValue(discountCodeFixtures.voucherReuse.id)).toBe(
    voucherReuseUsedValue + discountCodeFixtures.voucherReuse.creditPerRun.value
  );
  expect(issuedValue(discountCodeFixtures.voucherFull.id)).toBe(
    discountCodeFixtures.voucherFull.creditPerRun.value
  );
  expect(issuedValue(discountCodeFixtures.accountReferralVoucher.id)).toBe(
    discountCodeFixtures.accountReferralVoucher.creditPerRun.value
  );
});

const statementShape = (sql: string) => {
  const normalized = sql.replaceAll('"', "").toLowerCase();
  const verb = normalized.split(" ")[0] ?? "";
  if (verb === "begin" || verb === "commit") return verb;
  const table = normalized.match(/(?:into|from) ([a-z_]+)/)?.[1];
  return verb === "select"
    ? `select from ${table}`
    : `${verb} ${verb === "insert" ? "into" : "from"} ${table}`;
};

const statementParams = (
  recording: Awaited<ReturnType<typeof makeRecordingWorkspaceDatabase>>,
  table: string
) => {
  const statement = recording.statements.find(
    ({ sql }) => statementShape(sql) === `insert into ${table}`
  );
  if (!statement) throw new Error(`No insert into ${table}`);
  return statement.params;
};
