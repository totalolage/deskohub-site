import { describe, expect, test } from "bun:test";
import { zipSync } from "fflate";

import {
  classifyWorkspaceE2EExportEmailDivergence,
  classifyWorkspaceE2EExportIdentityMatch,
  exportEmailDivergenceMessage,
  exportIdentityVerdictFailureMessage,
  workspaceE2EExportPageProbeScript,
} from "./export-identity";

describe("classifyWorkspaceE2EExportIdentityMatch", () => {
  test("reports a match only when both the account id and the email match", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: true,
        emailMatches: true,
      })
    ).toBe("match");
  });

  test("splits an account-id match with an email mismatch into the email divergence verdict", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: true,
        emailMatches: false,
      })
    ).toBe("email-mismatch");
  });

  test("splits an account-id mismatch into the session divergence verdict regardless of the email", () => {
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: false,
        emailMatches: false,
      })
    ).toBe("account-mismatch");
    expect(
      classifyWorkspaceE2EExportIdentityMatch({
        accountIdMatches: false,
        emailMatches: true,
      })
    ).toBe("account-mismatch");
  });
});

describe("exportIdentityVerdictFailureMessage", () => {
  test("never names a verdict-specific fact for a match", () => {
    expect(() => exportIdentityVerdictFailureMessage("match")).not.toThrow();
  });

  test("carries the discriminating fact for each divergence verdict", () => {
    expect(exportIdentityVerdictFailureMessage("account-mismatch")).toContain(
      "journaled"
    );
    expect(exportIdentityVerdictFailureMessage("email-mismatch")).toContain(
      "email"
    );
  });
});

describe("classifyWorkspaceE2EExportEmailDivergence", () => {
  const recipient = "delivered+run-main@example.test";

  test("reports every boolean as a full match when the document equals the row", () => {
    const divergence = classifyWorkspaceE2EExportEmailDivergence({
      documentEmail: recipient,
      rowEmail: recipient,
      recipientEmail: recipient,
      displayedEmail: recipient,
    });
    expect(divergence.exactEqual).toBe(true);
    expect(divergence.documentEmailMatchesRecipient).toBe(true);
    expect(divergence.equalAfterTrim).toBe(true);
    expect(divergence.equalCaseInsensitive).toBe(true);
    expect(divergence.equalAfterTrimAndCase).toBe(true);
    expect(divergence.documentEmailLonger).toBe(false);
    expect(divergence.documentEmailShorter).toBe(false);
    expect(divergence.displayedEmailMatchesDocument).toBe(true);
    expect(divergence.displayedEmailTrimmedMatchesDocument).toBe(true);
  });

  test("attributes a whitespace-only divergence to the trim comparison, not exact equality", () => {
    const divergence = classifyWorkspaceE2EExportEmailDivergence({
      documentEmail: recipient,
      rowEmail: ` ${recipient} `,
      recipientEmail: recipient,
      displayedEmail: recipient,
    });
    expect(divergence.exactEqual).toBe(false);
    expect(divergence.equalAfterTrim).toBe(true);
    expect(divergence.equalAfterTrimAndCase).toBe(true);
    expect(divergence.documentEmailShorter).toBe(true);
    expect(divergence.documentEmailLonger).toBe(false);
  });

  test("attributes a casing-only divergence to the case comparisons, not trim", () => {
    const divergence = classifyWorkspaceE2EExportEmailDivergence({
      documentEmail: recipient.toUpperCase(),
      rowEmail: recipient,
      recipientEmail: recipient,
      displayedEmail: null,
    });
    expect(divergence.exactEqual).toBe(false);
    expect(divergence.equalAfterTrim).toBe(false);
    expect(divergence.equalCaseInsensitive).toBe(true);
    expect(divergence.equalAfterTrimAndCase).toBe(true);
    expect(divergence.displayedEmailMatchesDocument).toBe(false);
  });

  test("reports an unrelated string as divergent under every normalization and a length relation", () => {
    const divergence = classifyWorkspaceE2EExportEmailDivergence({
      documentEmail: "delivered+run-other@example.test",
      rowEmail: recipient,
      recipientEmail: recipient,
      displayedEmail: "delivered+run-other@example.test",
    });
    expect(divergence.exactEqual).toBe(false);
    expect(divergence.documentEmailMatchesRecipient).toBe(false);
    expect(divergence.equalAfterTrim).toBe(false);
    expect(divergence.equalCaseInsensitive).toBe(false);
    expect(divergence.equalAfterTrimAndCase).toBe(false);
    expect(divergence.displayedEmailMatchesDocument).toBe(true);
  });

  test("treats a missing displayed email as a non-match without throwing", () => {
    const divergence = classifyWorkspaceE2EExportEmailDivergence({
      documentEmail: recipient,
      rowEmail: recipient,
      recipientEmail: recipient,
      displayedEmail: null,
    });
    expect(divergence.displayedEmailMatchesDocument).toBe(false);
    expect(divergence.displayedEmailTrimmedMatchesDocument).toBe(false);
  });
});

describe("exportEmailDivergenceMessage", () => {
  test("carries only closed booleans and the length relation, never a raw string argument", () => {
    const message = exportEmailDivergenceMessage(
      classifyWorkspaceE2EExportEmailDivergence({
        documentEmail: "document-only@example.test",
        rowEmail: "row-only@example.test",
        recipientEmail: "recipient@example.test",
        displayedEmail: null,
      })
    );
    expect(message).toContain("exact-equal=false");
    expect(message).toContain("document-email-matches-recipient=false");
    expect(message).toContain("equal-after-trim-and-case=false");
    expect(message).toContain("displayed-email-matches-document=false");
    expect(message).not.toContain("example.test");
    expect(message).not.toContain("document-only");
    expect(message).not.toContain("row-only");
    expect(message).not.toContain("recipient@");
  });
});

describe("workspaceE2EExportPageProbeScript", () => {
  const probeInput = {
    requestUrl: "/en-US/account/data-export",
    accountId: "00000000-0000-0000-0000-000000000000",
    rowEmail: "delivered+run-main@example.test",
    recipientEmail: "delivered+run-main@example.test",
    profileEmailSelector: "#account-profile-email",
  };
  const identityEntry = {
    accountId: "00000000-0000-0000-0000-000000000000",
    email: "delivered+run-main@example.test",
  };
  const archiveBytes = () =>
    zipSync(
      {
        "manifest.json": Buffer.from(
          JSON.stringify({
            generatedAt: "2026-01-01T00:00:00Z",
            schemaVersion: 2,
            sections: [{ path: "identity.json", description: "d" }],
          })
        ),
        "identity.json": Buffer.from(JSON.stringify(identityEntry)),
        "dotypos-profile.json": Buffer.from(
          JSON.stringify({
            firstName: "Ada",
            lastName: null,
            phone: null,
            billing: null,
          })
        ),
        "reservation-history.json": Buffer.from(JSON.stringify([])),
        "workspace-reservations.json": Buffer.from(JSON.stringify([])),
        "payments.json": Buffer.from(
          JSON.stringify({ payments: [], latePaymentRecoveries: [] })
        ),
        "discount-applications.json": Buffer.from(JSON.stringify([])),
        "invoices.json": Buffer.from(
          JSON.stringify({ invoices: [], customerEmailDeliveries: [] })
        ),
        "consents.json": Buffer.from(
          JSON.stringify({ marketingConsent: null, legalEvidenceEvents: [] })
        ),
        "access-grants.json": Buffer.from(JSON.stringify({ accessGrants: [] })),
      },
      // Stored entries keep the fixture independent of the environment's
      // DecompressionStream; the production archive deflates and the browser
      // inflates through the same probe code path.
      { level: 0 }
    );

  const compile = () => {
    const script = workspaceE2EExportPageProbeScript(probeInput);
    return new Function(
      "document",
      "fetch",
      `"use strict"; return (${script});`
    ) as (document: unknown, fetch: unknown) => Promise<string>;
  };

  const zipResponse = () => ({
    ok: true,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === "content-type" ? "application/zip" : null,
    },
    arrayBuffer: async () => archiveBytes().buffer,
  });

  const pageWithDisplayedEmail = (value: string | null) => {
    // The probe guards `instanceof HTMLInputElement` because the page script
    // must tolerate exotic environments; the node test provides the class.
    (globalThis as { HTMLInputElement?: unknown }).HTMLInputElement ??=
      class HTMLInputElement {};
    const element = new (
      globalThis as { HTMLInputElement: new () => { value: string } }
    ).HTMLInputElement();
    element.value = value;
    return {
      querySelector: () => (value === null ? null : element),
    };
  };

  test("resolves with a well-formed payload when the displayed email input is missing entirely", async () => {
    const run = compile();
    const raw = await run(pageWithDisplayedEmail(null), async () =>
      zipResponse()
    );
    const payload = JSON.parse(raw) as {
      ok: boolean;
      document: {
        emailDivergence: Record<string, boolean>;
        accountIdMatches: boolean;
        entryNames: readonly string[];
        schemaVersion: number;
        manifestSectionPaths: readonly string[];
        reservationsCount: number;
        consentKeys: readonly string[] | null;
        dotyposProfileKeys: readonly string[] | null;
      } | null;
    };
    expect(payload.ok).toBe(true);
    expect(payload.document?.accountIdMatches).toBe(true);
    expect(payload.document?.entryNames.sort()).toEqual([
      "access-grants.json",
      "consents.json",
      "discount-applications.json",
      "dotypos-profile.json",
      "identity.json",
      "invoices.json",
      "manifest.json",
      "payments.json",
      "reservation-history.json",
      "workspace-reservations.json",
    ]);
    expect(payload.document?.schemaVersion).toBe(2);
    expect(payload.document?.manifestSectionPaths).toEqual(["identity.json"]);
    expect(payload.document?.reservationsCount).toBe(0);
    expect(payload.document?.consentKeys).toBeNull();
    expect(payload.document?.dotyposProfileKeys).toEqual([
      "billing",
      "firstName",
      "lastName",
      "phone",
    ]);
    // No throw, and the displayed-email booleans degrade to false rather
    // than being silently skipped or crashing the probe.
    expect(
      payload.document?.emailDivergence.displayedEmailMatchesDocument
    ).toBe(false);
    expect(payload.document?.emailDivergence.exactEqual).toBe(true);
  });

  test("compares the displayed email live when the profile input is present in the same document", async () => {
    const run = compile();
    const raw = await run(
      pageWithDisplayedEmail("delivered+run-main@example.test"),
      async () => zipResponse()
    );
    const payload = JSON.parse(raw) as {
      document: { emailDivergence: Record<string, boolean> } | null;
    };
    expect(
      payload.document?.emailDivergence.displayedEmailMatchesDocument
    ).toBe(true);
    expect(
      payload.document?.emailDivergence.displayedEmailTrimmedMatchesDocument
    ).toBe(true);
  });

  test("reports a non-ZIP response as ok=false with a null document", async () => {
    const run = compile();
    const raw = await run(pageWithDisplayedEmail(null), async () => ({
      ok: true,
      headers: {
        get: (name: string) =>
          name.toLowerCase() === "content-type" ? "application/json" : null,
      },
      arrayBuffer: async () => new ArrayBuffer(0),
    }));
    const payload = JSON.parse(raw) as { ok: boolean; document: unknown };
    expect(payload.ok).toBe(false);
    expect(payload.document).toBeNull();
  });

  test("reports a failed fetch as ok=false with a null document instead of throwing", async () => {
    const run = compile();
    const raw = await run(pageWithDisplayedEmail(null), async () => {
      throw new Error("network failure");
    });
    const payload = JSON.parse(raw) as { ok: boolean; document: unknown };
    expect(payload.ok).toBe(false);
    expect(payload.document).toBeNull();
  });
});
