import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  AdminCliAccountsApi,
  AdministrationAccountBackfillInput,
  AdministrationAccountBackfillReport,
} from "./accounts";

describe("accounts contract", () => {
  test("serves the customer backfill under the CLI prefix", () => {
    const endpoint = AdminCliAccountsApi.endpoints.backfillAccounts;

    expect(endpoint?.method).toBe("POST");
    expect(endpoint?.path).toBe("/api/v1/cli/accounts/backfill");
  });

  test("rejects excess backfill input properties", () => {
    const decode = Schema.decodeUnknownSync(AdministrationAccountBackfillInput);

    expect(decode({ dryRun: true })).toEqual({ dryRun: true });
    expect(() => decode({ dryRun: true, email: "unexpected" })).toThrow();
  });

  test("decodes reports and rejects unknown refusal reasons", () => {
    const decode = Schema.decodeUnknownSync(
      AdministrationAccountBackfillReport
    );
    const report = {
      dryRun: false,
      logins: { created: 2, alreadyPresent: 3 },
      links: { recorded: 4, alreadyRecorded: 5, conflicts: 6 },
      tombstones: { recorded: 7, alreadyDeleted: 8, skippedRecent: 9 },
      authors: {
        alreadyAuthored: 10,
        viaLink: { customers: 11, reservations: 12 },
        viaNewLogin: { customers: 13, reservations: 14 },
        viaResumedLogin: { customers: 15, reservations: 16 },
        refused: [
          {
            dotyposCustomerId: "customer-test-1",
            reason: "email_missing",
            reservations: 17,
          },
        ],
        remainingCustomers: 18,
      },
    } as const;

    expect(JSON.parse(JSON.stringify(decode(report)))).toEqual(report);
    expect(() =>
      decode({
        ...report,
        authors: {
          ...report.authors,
          refused: [{ ...report.authors.refused[0], reason: "unknown_reason" }],
        },
      })
    ).toThrow();
  });
});
