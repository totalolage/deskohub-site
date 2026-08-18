import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { getTableColumns } from "drizzle-orm";
import { Schema } from "effect";
import { manualInvoiceCreationRequests } from "@/db/schema";
import { getManualInvoiceCreationRequestJson } from "./invoice-administration.service";
import { getManualInvoiceCreationRequestDigest } from "./manual-invoice-creation-requests.service";

const decodeInput = Schema.decodeUnknownSync(AdministrationInvoiceCreateInput, {
  onExcessProperty: "error",
});

const request = {
  invoiceId: "018f47d2-8f7c-7c5e-9f9a-6ef21f90cb21",
  customer: {
    kind: "new",
    details: {
      kind: "business",
      email: "billing@example.test",
      phone: "+420 123 456 789",
      companyName: "Example s.r.o.",
      companyId: "12345678",
      vatId: "CZ12345678",
      firstName: "Ada",
      lastName: "Lovelace",
      address: {
        line1: "Example 1",
        line2: "Floor 2",
        city: "Prague",
        postalCode: "110 00",
        country: "CZ",
      },
    },
  },
  locale: "en-US",
  serviceDate: "2026-08-18",
  dueDate: "2026-09-01",
  currency: "CZK",
  variableSymbol: "2026000001",
  lines: [{ description: "Room hire", price: "1200.00" }],
} as const;

describe("manual invoice creation request claims", () => {
  test("normalizes the complete request before producing a keyed digest", () => {
    const input = decodeInput(request);
    const equivalent = decodeInput({
      ...request,
      customer: {
        ...request.customer,
        details: {
          ...request.customer.details,
          email: ` ${request.customer.details.email} `,
        },
      },
      lines: [{ description: " Room hire ", price: "1200.0" }],
    });
    const provenance = { source: "admin-ui", actor: "admin" } as const;
    const json = getManualInvoiceCreationRequestJson(input, provenance);
    const equivalentJson = getManualInvoiceCreationRequestJson(
      equivalent,
      provenance
    );

    expect(equivalentJson).toBe(json);
    expect(getManualInvoiceCreationRequestDigest(json, "key one")).toMatch(
      /^[A-Za-z0-9_-]{43}$/
    );
    expect(getManualInvoiceCreationRequestDigest(json, "key one")).not.toBe(
      getManualInvoiceCreationRequestDigest(json, "key two")
    );
  });

  test("binds contact, customer choice, invoice facts, lines, and provenance", () => {
    const input = decodeInput(request);
    const provenance = { source: "admin-ui", actor: "admin" } as const;
    const original = getManualInvoiceCreationRequestDigest(
      getManualInvoiceCreationRequestJson(input, provenance),
      "claim key"
    );
    const changedRequests = [
      {
        ...request,
        customer: {
          kind: "existing",
          customerId: "customer-1",
          details: request.customer.details,
        },
      },
      {
        ...request,
        customer: {
          ...request.customer,
          details: {
            ...request.customer.details,
            phone: "+420 999 999 999",
          },
        },
      },
      { ...request, dueDate: "2026-09-02" },
      { ...request, variableSymbol: "2026000002" },
      { ...request, lines: [{ description: "Equipment hire", price: "1200" }] },
    ];

    for (const changed of changedRequests) {
      const digest = getManualInvoiceCreationRequestDigest(
        getManualInvoiceCreationRequestJson(decodeInput(changed), provenance),
        "claim key"
      );
      expect(digest).not.toBe(original);
    }
    expect(
      getManualInvoiceCreationRequestDigest(
        getManualInvoiceCreationRequestJson(input, {
          source: "dhw-cli",
          actor: "another-admin",
        }),
        "claim key"
      )
    ).not.toBe(original);
  });

  test("persists only non-PII claim metadata", () => {
    expect(Object.keys(getTableColumns(manualInvoiceCreationRequests))).toEqual(
      ["invoiceId", "keyId", "requestDigest", "claimedAt", "completedAt"]
    );
  });

  test("holds a namespaced transaction advisory lock around creation", async () => {
    const source = await Bun.file(
      `${import.meta.dir}/manual-invoice-creation-requests.service.ts`
    ).text();
    const withLock = source.slice(source.indexOf("const withLock"));

    expect(withLock).toContain("db.transaction");
    expect(withLock).toContain(
      "pg_advisory_xact_lock(hashtext('manual-invoice-creation'), hashtext("
    );
    expect(withLock.indexOf("pg_advisory_xact_lock(")).toBeLessThan(
      withLock.indexOf("Effect.andThen(effect)")
    );
  });
});
