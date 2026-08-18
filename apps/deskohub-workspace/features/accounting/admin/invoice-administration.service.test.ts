import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceId } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import {
  makeCoworkInvoiceDocument,
  makeTestManualInvoiceDocument,
} from "@/features/accounting/invoice.test-utils";
import {
  decodeInvoiceAdministrationId,
  getInvoiceAdministrationPaymentStatus,
  type InvoiceAdministrationListItem,
  InvoiceAdministrationNotFoundError,
  sortInvoiceAdministrationItems,
} from "./invoice-administration.service";

const item = (
  id: string,
  input: Partial<InvoiceAdministrationListItem> = {}
): InvoiceAdministrationListItem => ({
  id: AdministrationInvoiceId.make(id),
  invoiceNumber: id,
  issuedAt: "2026-08-18T10:00:00.000Z",
  customerName: id,
  total: "0",
  currency: "CZK",
  paymentStatus: "paid",
  source: "legacy",
  actor: null,
  delivery: { customer: "accepted", internal: "accepted" },
  needsAttention: false,
  ...input,
});

describe("invoice administration sorting", () => {
  test("groups attention only by default and compares decimal totals exactly", () => {
    const olderAttention = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21", {
      issuedAt: "2026-01-01T00:00:00.000Z",
      needsAttention: true,
      total: "900719925474099312345678.01",
    });
    const newer = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      issuedAt: "2026-08-18T00:00:00.000Z",
      total: "900719925474099312345678.02",
    });

    expect(sortInvoiceAdministrationItems([newer, olderAttention], {})).toEqual(
      [olderAttention, newer]
    );
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "total",
        direction: "asc",
      })
    ).toEqual([olderAttention, newer]);
    expect(
      sortInvoiceAdministrationItems([olderAttention, newer], {
        sort: "issuedAt",
        direction: "desc",
      })
    ).toEqual([newer, olderAttention]);
  });

  test("sorts payment status only when explicitly requested", () => {
    const paid = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21");
    const overdue = item("018f47d2-8f7c-7c5e-9f9a-6ef21f90cb22", {
      paymentStatus: "overdue",
      needsAttention: true,
    });

    expect(
      sortInvoiceAdministrationItems([overdue, paid], {
        sort: "paymentStatus",
        direction: "asc",
      })
    ).toEqual([overdue, paid]);
  });
});

describe("invoice administration payment status", () => {
  const manual = makeTestManualInvoiceDocument("en-US");

  test("keeps reservation invoices paid", () => {
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeCoworkInvoiceDocument("en-US"),
        "2099-01-01"
      )
    ).toBe("paid");
  });

  test("derives manual status from the Prague calendar date", () => {
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-08-31")).toBe(
      "issued"
    );
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-09-01")).toBe(
      "due"
    );
    expect(getInvoiceAdministrationPaymentStatus(manual, "2026-09-02")).toBe(
      "overdue"
    );
  });

  test("keeps zero and negative manual totals issued after their due date", () => {
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeTestManualInvoiceDocument("en-US", "0"),
        "2026-09-02"
      )
    ).toBe("issued");
    expect(
      getInvoiceAdministrationPaymentStatus(
        makeTestManualInvoiceDocument("en-US", "-1"),
        "2026-09-02"
      )
    ).toBe("issued");
  });

  test("maps malformed route ids to not found", () => {
    const error = Effect.runSync(
      decodeInvoiceAdministrationId("not-an-invoice-id").pipe(Effect.flip)
    );
    expect(error).toBeInstanceOf(InvoiceAdministrationNotFoundError);
  });
});
