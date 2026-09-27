/**
 * The closed verdict space for the account data export identity comparison.
 * The delivered document's `identity.accountId` is compared as a boolean
 * against the journaled Better Auth user id before the email string itself,
 * so one failed preview run decides between two root-cause classes: the
 * session belonged to a different identity (`account-mismatch`), or the
 * session identity was correct but its delivered email string diverged from
 * the synthetic recipient (`email-mismatch`).
 */
export type WorkspaceE2EExportIdentityVerdict =
  | "account-mismatch"
  | "email-mismatch"
  | "match";

export const classifyWorkspaceE2EExportIdentityMatch = (input: {
  readonly accountIdMatches: boolean;
  readonly emailMatches: boolean;
}): WorkspaceE2EExportIdentityVerdict => {
  if (!input.accountIdMatches) return "account-mismatch";
  return input.emailMatches ? "match" : "email-mismatch";
};

/**
 * The fixed failure message for one non-match verdict. The messages name
 * only the closed verdict class: they never carry the recipient address,
 * the delivered email, or any account identifier.
 */
export const exportIdentityVerdictFailureMessage = (
  verdict: WorkspaceE2EExportIdentityVerdict
): string => {
  switch (verdict) {
    case "account-mismatch":
      return "the export document identity was not the journaled synthetic account: the export session resolved to a different Better Auth identity";
    case "email-mismatch":
      return "the export identity email diverged from the synthetic recipient while the journaled account id matched: email-string divergence, not a session divergence";
    case "match":
      return "the export identity matched the synthetic expectations";
  }
};

/**
 * The closed boolean space that decides how a delivered export email diverges
 * from the exact synthetic auth row. Every field is computed inside the
 * authenticated page from the document email, the fixture row email, and the
 * displayed profile email; no raw email string, and not even a length, ever
 * leaves the page — only these booleans.
 */
export type WorkspaceE2EExportEmailDivergence = {
  readonly exactEqual: boolean;
  readonly documentEmailMatchesRecipient: boolean;
  readonly equalAfterTrim: boolean;
  readonly equalCaseInsensitive: boolean;
  readonly equalAfterTrimAndCase: boolean;
  readonly documentEmailLonger: boolean;
  readonly documentEmailShorter: boolean;
  readonly displayedEmailMatchesDocument: boolean;
  readonly displayedEmailTrimmedMatchesDocument: boolean;
};

/**
 * Classifies one email divergence from the raw page-local strings. The
 * comparison vocabulary mirrors the only normalizations the app boundary can
 * legitimately apply (Effect `Schema.Trim` at the session decode) so one
 * failed preview run decides between a whitespace, casing, length, or
 * wholly-different-string divergence.
 */
export const classifyWorkspaceE2EExportEmailDivergence = (input: {
  readonly documentEmail: string;
  readonly rowEmail: string;
  readonly recipientEmail: string;
  readonly displayedEmail: string | null;
}): WorkspaceE2EExportEmailDivergence => {
  const documentTrimmed = input.documentEmail.trim();
  const rowTrimmed = input.rowEmail.trim();
  const documentLowered = input.documentEmail.toLowerCase();
  const rowLowered = input.rowEmail.toLowerCase();
  return {
    exactEqual: input.documentEmail === input.rowEmail,
    documentEmailMatchesRecipient:
      input.documentEmail === input.recipientEmail,
    equalAfterTrim: documentTrimmed === rowTrimmed,
    equalCaseInsensitive: documentLowered === rowLowered,
    equalAfterTrimAndCase: documentTrimmed.toLowerCase() === rowTrimmed.toLowerCase(),
    documentEmailLonger:
      input.documentEmail.length > input.rowEmail.length,
    documentEmailShorter:
      input.documentEmail.length < input.rowEmail.length,
    displayedEmailMatchesDocument:
      input.displayedEmail !== null &&
      input.displayedEmail === input.documentEmail,
    displayedEmailTrimmedMatchesDocument:
      input.displayedEmail !== null &&
      input.displayedEmail.trim() === input.documentEmail,
  };
};

/**
 * The fixed failure message for the email-mismatch verdict with the closed
 * divergence booleans attached. The message carries booleans and the length
 * relation only: never the recipient, the delivered email, or the row email.
 */
export const exportEmailDivergenceMessage = (
  divergence: WorkspaceE2EExportEmailDivergence
): string =>
  [
    exportIdentityVerdictFailureMessage("email-mismatch"),
    `exact-equal=${divergence.exactEqual}`,
    `document-email-matches-recipient=${divergence.documentEmailMatchesRecipient}`,
    `equal-after-trim=${divergence.equalAfterTrim}`,
    `equal-case-insensitive=${divergence.equalCaseInsensitive}`,
    `equal-after-trim-and-case=${divergence.equalAfterTrimAndCase}`,
    `document-email-longer=${divergence.documentEmailLonger}`,
    `document-email-shorter=${divergence.documentEmailShorter}`,
    `displayed-email-matches-document=${divergence.displayedEmailMatchesDocument}`,
    `displayed-email-trimmed-matches-document=${divergence.displayedEmailTrimmedMatchesDocument}`,
  ].join("; ");

/**
 * The closed, boolean-only facts the in-page export probe returns. The
 * snapshot body never crosses to the runner: only these structural keys,
 * counts, header strings, and the divergence booleans do.
 */
export type WorkspaceE2EExportProbeDocumentFacts = {
  readonly accountIdMatches: boolean;
  readonly consentKeys: readonly string[] | null;
  readonly dotyposProfileKeys: readonly string[] | null;
  readonly emailDivergence: WorkspaceE2EExportEmailDivergence;
  readonly generatedAt: string;
  readonly keys: readonly string[];
  readonly reservationsCount: number;
  readonly schemaVersion: number;
  readonly scope: readonly string[];
};

export type WorkspaceE2EExportProbePayload = {
  readonly requestUrl: string;
  readonly cacheControl: string | null;
  readonly contentDisposition: string | null;
  readonly contentType: string | null;
  readonly ok: boolean;
  readonly document: WorkspaceE2EExportProbeDocumentFacts | null;
};

/**
 * Builds the page script for the account data export probe. The script is an
 * async IIFE that reads the displayed profile email **live from the current
 * document**, fetches the export document in the same authenticated document,
 * computes every divergence boolean with the same classifier the runner-side
 * tests exercise (the classifier source is embedded verbatim), and resolves
 * with the closed JSON payload.
 *
 * The probe must run in the document that displays the profile email: any
 * navigation between capturing that email and probing the export destroys
 * the displayed value, which is exactly how a window-stash version went
 * blind. This builder keeps the capture and the fetch in one evaluation.
 */
export const workspaceE2EExportPageProbeScript = (input: {
  readonly requestUrl: string;
  readonly accountId: string;
  readonly rowEmail: string;
  readonly recipientEmail: string;
  readonly profileEmailSelector: string;
}): string => `(async () => {
  const classifyDivergence = ${classifyWorkspaceE2EExportEmailDivergence.toString()};
  const emailField = document.querySelector(${JSON.stringify(input.profileEmailSelector)});
  const displayedValue =
    emailField !== null &&
    typeof HTMLInputElement !== "undefined" &&
    emailField instanceof HTMLInputElement
      ? emailField.value
      : undefined;
  const displayedEmail =
    typeof displayedValue === "string" ? displayedValue : null;
  try {
    const response = await fetch(${JSON.stringify(input.requestUrl)}, {
      headers: { accept: "application/json" },
    });
    const text = await response.text();
    const parsed = response.ok ? JSON.parse(text) : null;
    const documentEmail =
      parsed !== null && typeof parsed.identity?.email === "string"
        ? parsed.identity.email
        : null;
    return JSON.stringify({
      requestUrl: ${JSON.stringify(input.requestUrl)},
      cacheControl: response.headers.get("cache-control"),
      contentDisposition: response.headers.get("content-disposition"),
      contentType: response.headers.get("content-type"),
      ok: response.ok,
      document:
        parsed === null || documentEmail === null
          ? null
          : {
              accountIdMatches:
                parsed.identity.accountId === ${JSON.stringify(input.accountId)},
              consentKeys:
                parsed.marketingConsent === null
                  ? null
                  : Object.keys(parsed.marketingConsent).sort(),
              dotyposProfileKeys:
                parsed.dotyposProfile === null
                  ? null
                  : Object.keys(parsed.dotyposProfile).sort(),
              emailDivergence: classifyDivergence({
                documentEmail,
                rowEmail: ${JSON.stringify(input.rowEmail)},
                recipientEmail: ${JSON.stringify(input.recipientEmail)},
                displayedEmail,
              }),
              generatedAt: parsed.meta.generatedAt,
              keys: Object.keys(parsed).sort(),
              reservationsCount: Array.isArray(parsed.reservations)
                ? parsed.reservations.length
                : -1,
              schemaVersion: parsed.meta.schemaVersion,
              scope: parsed.meta.scope,
            },
    });
  } catch {
    return JSON.stringify({ ok: false, document: null });
  }
})()`;
