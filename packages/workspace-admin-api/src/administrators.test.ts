import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import {
  AdminCliAdministratorsApi,
  AdministrationLegacyAdministratorBackfillInput,
  AdministrationLegacyAdministratorBackfillResult,
  type AdministrationLegacyAdministratorBackfillResult as BackfillResult,
} from "./administrators";
import { AdministrationLegacyUsername } from "./workspace-admin-api";

const email = testEmailAddress("legacy-administrator");

describe("administrators contract", () => {
  test("serves the legacy administrator backfill under the CLI prefix", () => {
    const endpoint =
      AdminCliAdministratorsApi.endpoints.backfillLegacyAdministrator;

    expect(endpoint?.method).toBe("POST");
    expect(endpoint?.path).toBe("/api/v1/cli/administrators/legacy-backfill");
  });

  test("strictly decodes the backfill input and trims the email", () => {
    const decode = Schema.decodeUnknownSync(
      AdministrationLegacyAdministratorBackfillInput
    );

    expect(
      decode({ legacyUsername: " admin ", email: ` ${email} `, dryRun: true })
    ).toEqual({
      legacyUsername: AdministrationLegacyUsername.make("admin"),
      email,
      dryRun: true,
    });
    expect(() =>
      decode({ legacyUsername: "admin", email, dryRun: true, role: "owner" })
    ).toThrow();
    expect(() =>
      decode({ legacyUsername: "admin", email: "not-an-email", dryRun: true })
    ).toThrow();
    expect(() => decode({ legacyUsername: "", email, dryRun: true })).toThrow();
    expect(() => decode({ legacyUsername: "admin", email })).toThrow();
  });

  test("decodes per-table counts as whole numbers", () => {
    const decode = Schema.decodeUnknownSync(
      AdministrationLegacyAdministratorBackfillResult
    );
    const counts = { linked: 1, alreadyLinked: 0, linkedToOtherAccount: 2 };
    const result: BackfillResult = {
      dryRun: false,
      administratorRole: "already_granted",
      cliSessions: counts,
      manualInvoices: counts,
      standaloneAccessCodeEvents: counts,
    };

    expect(decode(result)).toEqual(result);
    expect(() =>
      decode({ ...result, cliSessions: { ...counts, linked: 0.5 } })
    ).toThrow();
    expect(() => decode({ ...result, administratorRole: "revoked" })).toThrow();
  });
});
