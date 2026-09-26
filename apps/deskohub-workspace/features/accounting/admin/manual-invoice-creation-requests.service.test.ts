import { describe, expect, test } from "bun:test";
import { AdministrationInvoiceCreateInput } from "@deskohub/workspace-admin-api";
import { getTableColumns } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { manualInvoiceCreationRequests } from "@/db/schema";
import { makeRecordingWorkspaceDatabase } from "@/shared/testing/workspace-recording-database.test-utils";
import { AccountingSnapshotKeyService } from "../backend/accounting-snapshot-key.service";
import { getManualInvoiceCreationRequestJson } from "./invoice-administration.service";
import {
  getManualInvoiceCreationRequestDigest,
  ManualInvoiceCreationRequests,
} from "./manual-invoice-creation-requests.service";

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
  payment: { status: "due", date: "2026-09-01" },
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
    expect(JSON.parse(json)).toMatchObject({ dueDate: "2026-09-01" });
    expect(JSON.parse(json)).not.toHaveProperty("payment");
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
      { ...request, payment: { status: "due", date: "2026-09-02" } },
      { ...request, payment: { status: "paid", date: "2026-08-18" } },
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
    const recording = await makeRecordingWorkspaceDatabase();
    const requests = await Effect.runPromise(
      Effect.gen(function* () {
        return yield* ManualInvoiceCreationRequests;
      }).pipe(
        Effect.provide(
          ManualInvoiceCreationRequests.Default.pipe(
            Layer.provide(recording.layer),
            Layer.provide(
              Layer.succeed(
                AccountingSnapshotKeyService,
                AccountingSnapshotKeyService.of({
                  getActive: Effect.die("unused"),
                  getById: () => Effect.die("unused"),
                } as never)
              )
            )
          )
        )
      )
    );

    await Effect.runPromise(
      requests.withLock("manual-invoice-1", () => Effect.succeed("inside"))
    );

    const sqlTexts = recording.statements.map(({ sql }) => sql);
    expect(sqlTexts[0].toLowerCase()).toBe("begin");
    expect(sqlTexts[1]).toContain("pg_advisory_xact_lock");
    expect(sqlTexts[1]).toContain("hashtext('manual-invoice-creation')");
    expect(sqlTexts.at(-1)?.toLowerCase()).toBe("commit");
  });
});
