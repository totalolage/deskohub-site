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
    documentEmailMatchesRecipient: input.documentEmail === input.recipientEmail,
    equalAfterTrim: documentTrimmed === rowTrimmed,
    equalCaseInsensitive: documentLowered === rowLowered,
    equalAfterTrimAndCase:
      documentTrimmed.toLowerCase() === rowTrimmed.toLowerCase(),
    documentEmailLonger: input.documentEmail.length > input.rowEmail.length,
    documentEmailShorter: input.documentEmail.length < input.rowEmail.length,
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
 * archive body never crosses to the runner: only these structural entry
 * names, manifest fields, counts, header strings, and the divergence
 * booleans do. The probe parses the downloaded ZIP inside the page —
 * central directory entry names plus the inflated manifest, identity, and
 * profile entries — so the assertion exercises a real browser download of
 * the `.zip` artifact without moving its payload out of the page.
 */
export type WorkspaceE2EExportProbeDocumentFacts = {
  readonly accountIdMatches: boolean;
  readonly consentKeys: readonly string[] | null;
  readonly dotyposProfileKeys: readonly string[] | null;
  readonly emailDivergence: WorkspaceE2EExportEmailDivergence;
  readonly entryNames: readonly string[];
  readonly generatedAt: string;
  readonly legalEvidenceCount: number;
  readonly manifestSectionPaths: readonly string[];
  readonly workspaceReservationsCount: number;
  readonly paymentsCount: number;
  readonly discountApplicationsCount: number;
  readonly invoicesCount: number;
  readonly accessGrantsCount: number;
  readonly reservationsCount: number;
  readonly schemaVersion: number;
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
 * The in-page ZIP reader source. It is embedded verbatim into the probe
 * script: a minimal central-directory scan (entry names, methods, sizes,
 * local offsets) plus raw-store/deflate-raw entry inflation through the
 * browser's DecompressionStream. It resolves to parsed JSON objects for the
 * requested entries, or null entries for anything it cannot inflate.
 */
const zipReaderSource = `
  const eocdOf = (bytes) => {
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65558); i -= 1) {
      if (bytes[i] === 0x50 && bytes[i + 1] === 0x4b && bytes[i + 2] === 0x05 && bytes[i + 3] === 0x06) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return {
          entryCount: view.getUint16(i + 10, true),
          directoryOffset: view.getUint32(i + 16, true),
        };
      }
    }
    return null;
  };
  const centralEntries = (bytes, eocd) => {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = new Map();
    let at = eocd.directoryOffset;
    for (let n = 0; n < eocd.entryCount; n += 1) {
      if (view.getUint32(at, true) !== 0x02014b50) return null;
      const method = view.getUint16(at + 10, true);
      const compressedSize = view.getUint32(at + 20, true);
      const nameLength = view.getUint16(at + 28, true);
      const extraLength = view.getUint16(at + 30, true);
      const commentLength = view.getUint16(at + 32, true);
      const localOffset = view.getUint32(at + 42, true);
      const name = new TextDecoder().decode(bytes.subarray(at + 46, at + 46 + nameLength));
      entries.set(name, { method, compressedSize, localOffset });
      at += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
  };
  const inflateEntry = async (bytes, dirEntries, name) => {
    const entry = dirEntries.get(name);
    if (!entry) return null;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const at = entry.localOffset;
    if (view.getUint32(at, true) !== 0x04034b50) return null;
    const nameLength = view.getUint16(at + 26, true);
    const extraLength = view.getUint16(at + 28, true);
    const dataStart = at + 30 + nameLength + extraLength;
    const compressed = bytes.subarray(dataStart, dataStart + entry.compressedSize);
    let plain = null;
    if (entry.method === 0) {
      plain = compressed;
    } else if (entry.method === 8 && typeof DecompressionStream === "function") {
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      plain = new Uint8Array(await new Response(stream).arrayBuffer());
    } else {
      return null;
    }
    return JSON.parse(new TextDecoder().decode(plain));
  };
`;

/**
 * Builds the page script for the account data export probe. The script is an
 * async IIFE that reads the displayed profile email **live from the current
 * document**, fetches the export archive in the same authenticated document,
 * parses the downloaded ZIP in-page, computes every divergence boolean with
 * the same classifier the runner-side tests exercise, and resolves with the
 * closed JSON payload.
 *
 * The probe must run in the document that displays the profile email: any
 * navigation between capturing that email and probing the export destroys
 * the displayed value, which is exactly how a window-stash version went
 * blind. This builder keeps the capture, the download, and the parse in one
 * evaluation.
 */
export const workspaceE2EExportPageProbeScript = (input: {
  readonly requestUrl: string;
  readonly accountId: string;
  readonly rowEmail: string;
  readonly recipientEmail: string;
  readonly profileEmailSelector: string;
}): string => `(async () => {
  const classifyDivergence = ${classifyWorkspaceE2EExportEmailDivergence.toString()};
  ${zipReaderSource}
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
      headers: { accept: "application/zip" },
    });
    const contentType = response.headers.get("content-type");
    const cacheControl = response.headers.get("cache-control");
    const contentDisposition = response.headers.get("content-disposition");
    if (!response.ok || !(contentType ?? "").startsWith("application/zip")) {
      return JSON.stringify({
        requestUrl: ${JSON.stringify(input.requestUrl)},
        cacheControl,
        contentDisposition,
        contentType,
        ok: false,
        document: null,
      });
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    const eocd = eocdOf(bytes);
    const entries = eocd === null ? null : centralEntries(bytes, eocd);
    if (entries === null) {
      return JSON.stringify({
        requestUrl: ${JSON.stringify(input.requestUrl)},
        cacheControl,
        contentDisposition,
        contentType,
        ok: false,
        document: null,
      });
    }
    const manifest = await inflateEntry(bytes, entries, "manifest.json");
    const identity = await inflateEntry(bytes, entries, "identity.json");
    const dotyposProfile = await inflateEntry(bytes, entries, "dotypos-profile.json");
    const consents = await inflateEntry(bytes, entries, "consents.json");
    const reservationHistory = await inflateEntry(bytes, entries, "reservation-history.json");
    const workspaceReservations = await inflateEntry(bytes, entries, "workspace-reservations.json");
    const payments = await inflateEntry(bytes, entries, "payments.json");
    const discountApplications = await inflateEntry(bytes, entries, "discount-applications.json");
    const invoices = await inflateEntry(bytes, entries, "invoices.json");
    const accessGrants = await inflateEntry(bytes, entries, "access-grants.json");
    const documentEmail =
      identity !== null && typeof identity.email === "string"
        ? identity.email
        : null;
    return JSON.stringify({
      requestUrl: ${JSON.stringify(input.requestUrl)},
      cacheControl,
      contentDisposition,
      contentType,
      ok: true,
      document:
        manifest === null || documentEmail === null
          ? null
          : {
              accountIdMatches:
                identity.accountId === ${JSON.stringify(input.accountId)},
              consentKeys:
                consents === null || consents.marketingConsent === null
                  ? null
                  : Object.keys(consents.marketingConsent).sort(),
              dotyposProfileKeys:
                dotyposProfile === null
                  ? null
                  : Object.keys(dotyposProfile).sort(),
              emailDivergence: classifyDivergence({
                documentEmail,
                rowEmail: ${JSON.stringify(input.rowEmail)},
                recipientEmail: ${JSON.stringify(input.recipientEmail)},
                displayedEmail,
              }),
              entryNames: Array.from(entries.keys()).sort(),
              generatedAt: manifest.generatedAt,
              legalEvidenceCount: consents === null || !Array.isArray(consents.legalEvidenceEvents) ? -1 : consents.legalEvidenceEvents.length,
              manifestSectionPaths: Array.isArray(manifest.sections)
                ? manifest.sections.map((section) => section.path)
                : [],
              reservationsCount: Array.isArray(reservationHistory)
                ? reservationHistory.length
                : -1,
              schemaVersion: manifest.schemaVersion,
              workspaceReservationsCount: Array.isArray(workspaceReservations) ? workspaceReservations.length : -1,
              paymentsCount:
                payments !== null && Array.isArray(payments.payments)
                  ? payments.payments.length
                  : -1,
              discountApplicationsCount: Array.isArray(discountApplications) ? discountApplications.length : -1,
              invoicesCount:
                invoices !== null && Array.isArray(invoices.invoices)
                  ? invoices.invoices.length
                  : -1,
              accessGrantsCount:
                accessGrants !== null && Array.isArray(accessGrants.accessGrants)
                  ? accessGrants.accessGrants.length
                  : -1,
            },
    });
  } catch {
    return JSON.stringify({ ok: false, document: null });
  }
})()`;
