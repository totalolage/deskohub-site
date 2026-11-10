"use client";

import { Data, Effect } from "effect";
import { ChevronDown, Download, Loader2 } from "lucide-react";
import { useId, useState } from "react";
import { accountDataExportSections } from "@/features/account/account-data-export-sections";
import { type Locale, m } from "@/features/i18n";
import {
  getAttachmentFileName,
  saveBlobAsFile,
} from "@/shared/browser/file-download";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { Button } from "@/shared/components/ui/button";
import { DisclosureButton } from "@/shared/components/ui/disclosure-button";

/**
 * Where the last download request stands. `delivered` means the browser was
 * handed the file, not that it finished saving it.
 */
type AccountDataExportState = "idle" | "pending" | "delivered" | "error";

class AccountDataExportError extends Data.TaggedError(
  "AccountDataExportError"
)<{
  readonly cause?: unknown;
  readonly status?: number;
}> {}

const exportFailureCode = "account.data-export.failed";

// A refused or signed-out request answers with an error page, never a ZIP
// attachment, so only that counts as the archive.
const isZipAttachment = (response: Response) =>
  response.ok &&
  /^application\/zip\b/i.test(response.headers.get("Content-Type") ?? "") &&
  /^attachment\b/i.test(response.headers.get("Content-Disposition") ?? "");

/**
 * Downloads the archive and hands it to the browser as a file. Any failure
 * is reported with a fixed code and answers `error`; the archive body never
 * reaches logs.
 */
const downloadAccountData = (href: string) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(href, { cache: "no-store", credentials: "same-origin", signal }),
    catch: (cause) => new AccountDataExportError({ cause }),
  }).pipe(
    Effect.filterOrFail(
      isZipAttachment,
      (response) => new AccountDataExportError({ status: response.status })
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.blob(),
        catch: (cause) => new AccountDataExportError({ cause }),
      }).pipe(
        Effect.map((blob) => ({
          blob,
          fileName:
            getAttachmentFileName(response) ?? "deskohub-account-data.zip",
        }))
      )
    ),
    Effect.flatMap((file) =>
      Effect.try({
        try: () => saveBlobAsFile(file),
        catch: (cause) => new AccountDataExportError({ cause }),
      })
    ),
    Effect.as<AccountDataExportState>("delivered"),
    Effect.tapError((error) =>
      reportWorkspaceBrowserFailure(exportFailureCode, error)
    ),
    Effect.catchTag("AccountDataExportError", () =>
      Effect.succeed<AccountDataExportState>("error")
    ),
    Effect.catchDefect((defect) =>
      reportWorkspaceBrowserFailure(exportFailureCode, defect).pipe(
        Effect.as<AccountDataExportState>("error")
      )
    )
  );

/**
 * The signed-in customer's account data download: the action in its own row,
 * a status region announcing each outcome, then a disclosure listing the
 * archive's sections from the shared catalog. `href` is the localized export
 * route.
 */
export function AccountDataExport({
  href,
  locale,
}: {
  readonly href: string;
  readonly locale: Locale;
}) {
  const [state, setState] = useState<AccountDataExportState>("idle");
  const [contentsOpen, setContentsOpen] = useState(false);
  const contentsId = useId();
  const pending = state === "pending";

  const startDownload = () => {
    if (pending) return;
    setState("pending");
    void downloadAccountData(href)
      .pipe(runWorkspaceBrowserEffect("account.data-export"))
      .then(setState);
  };

  return (
    <div
      className="mt-4 min-w-0"
      data-slot="account-data-export"
      data-state={state}
    >
      <Button
        aria-disabled={pending}
        data-slot="account-data-export-action"
        onClick={startDownload}
        type="button"
        variant="secondary"
        wrap
      >
        {pending ? (
          <Loader2
            aria-hidden="true"
            className="size-4 shrink-0 motion-safe:animate-spin"
          />
        ) : (
          <Download aria-hidden="true" className="size-4 shrink-0" />
        )}
        {m.legalScreenExportAction({}, { locale })}
      </Button>
      <div
        aria-live="polite"
        className="text-sm leading-5"
        data-slot="account-data-export-status"
        role="status"
      >
        {state !== "idle" && (
          <p
            className={
              state === "error" ? "mt-2 text-red-700" : "mt-2 text-[#586c88]"
            }
          >
            {{
              pending: m.legalScreenExportPendingStatus,
              delivered: m.legalScreenExportDeliveredStatus,
              error: m.legalScreenExportErrorStatus,
            }[state]({}, { locale })}
          </p>
        )}
      </div>
      <DisclosureButton
        className="mt-3 -ml-3"
        controls={contentsId}
        data-slot="account-data-export-contents-toggle"
        expanded={contentsOpen}
        onClick={() => setContentsOpen((open) => !open)}
        tone="muted"
        variant="ghost"
        wrap
      >
        <ChevronDown
          aria-hidden="true"
          className={`size-4 shrink-0 transition-transform motion-reduce:transition-none ${
            contentsOpen ? "rotate-180" : ""
          }`}
        />
        {m.legalScreenExportContentsToggle({}, { locale })}
      </DisclosureButton>
      <ul
        className="mt-1 list-disc pl-5 text-sm leading-5 text-[#586c88]"
        data-slot="account-data-export-contents"
        hidden={!contentsOpen}
        id={contentsId}
      >
        {accountDataExportSections.map(({ path }) => (
          <li className="break-words" key={path}>
            {{
              "identity.json": m.legalScreenExportSectionIdentity,
              "dotypos-profile.json": m.legalScreenExportSectionDotyposProfile,
              "reservation-history.json":
                m.legalScreenExportSectionReservationHistory,
              "workspace-reservations.json":
                m.legalScreenExportSectionWorkspaceReservations,
              "payments.json": m.legalScreenExportSectionPayments,
              "discount-applications.json":
                m.legalScreenExportSectionDiscountApplications,
              "invoices.json": m.legalScreenExportSectionInvoices,
              "consents.json": m.legalScreenExportSectionConsents,
              "access-grants.json": m.legalScreenExportSectionAccessGrants,
            }[path]({}, { locale })}
          </li>
        ))}
        <li className="break-words">
          {m.legalScreenExportSectionManifest({}, { locale })}
        </li>
      </ul>
    </div>
  );
}
