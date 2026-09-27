"use client";

import { ChevronDown, Download } from "lucide-react";
import { useCallback, useId, useState } from "react";
import { accountDataExportSections } from "@/features/account/account-data-export-sections";
import { type Locale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";

type ExportRequestState =
  | { readonly kind: "idle" }
  | { readonly kind: "pending" }
  | { readonly kind: "delivered" }
  | { readonly kind: "error" };

const attachmentFilenameOf = (
  disposition: string | null,
  fallback: string
): string => {
  const match = disposition?.match(/filename="([^"]+)"/);
  return match?.[1] ?? fallback;
};

/**
 * The localized name for one archive section, keyed by the exact archive
 * entry path from the shared catalog so the UI list can never drift from
 * what the manifest declares.
 */
const sectionNameOf = (path: string, locale: Locale): string => {
  switch (path) {
    case "identity.json":
      return m.legalScreenExportSectionIdentity({}, { locale });
    case "dotypos-profile.json":
      return m.legalScreenExportSectionDotyposProfile({}, { locale });
    case "reservation-history.json":
      return m.legalScreenExportSectionReservationHistory({}, { locale });
    case "workspace-reservations.json":
      return m.legalScreenExportSectionWorkspaceReservations({}, { locale });
    case "payments.json":
      return m.legalScreenExportSectionPayments({}, { locale });
    case "discount-applications.json":
      return m.legalScreenExportSectionDiscountApplications({}, { locale });
    case "invoices.json":
      return m.legalScreenExportSectionInvoices({}, { locale });
    case "consents.json":
      return m.legalScreenExportSectionConsents({}, { locale });
    case "access-grants.json":
      return m.legalScreenExportSectionAccessGrants({}, { locale });
    default:
      return path;
  }
};

/**
 * The self-service account data download. The download action comes first —
 * it must be reachable without expanding anything — and the full archive
 * itemization is a secondary disclosure. The browser-only fetch keeps error
 * handling in the page and the archive body out of logs and traces; the
 * archive itself lives only in this response and the customer's browser.
 */
export function AccountDataExport({ locale }: { readonly locale: Locale }) {
  const [state, setState] = useState<ExportRequestState>({
    kind: "idle",
  });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const statusId = useId();
  const detailsId = useId();
  const pending = state.kind === "pending";

  const downloadExport = useCallback(async () => {
    setState({ kind: "pending" });
    try {
      const response = await fetch(`/${locale}/account/data-export`, {
        headers: { Accept: "application/zip" },
      });
      if (!response.ok) throw new Error("export-unavailable");
      const blob = await response.blob();
      const filename = attachmentFilenameOf(
        response.headers.get("Content-Disposition"),
        `deskohub-account-data-${new Date().toISOString().slice(0, 10)}.zip`
      );
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
      setState({ kind: "delivered" });
    } catch {
      setState({ kind: "error" });
    }
  }, [locale]);

  const statusMessage = (() => {
    if (state.kind === "delivered")
      return m.legalScreenExportDeliveredStatus({}, { locale });
    if (state.kind === "error")
      return m.legalScreenExportErrorStatus({}, { locale });
    if (pending) return m.legalScreenExportPendingStatus({}, { locale });
    return null;
  })();

  return (
    <div>
      <div className="mt-4 min-w-0">
        <Button
          aria-busy={pending}
          aria-controls={statusId}
          className="h-auto w-fit whitespace-normal px-4 py-2 text-center leading-5"
          disabled={pending}
          id="account-data-export"
          onClick={() => {
            void downloadExport();
          }}
          type="button"
          variant="secondary"
        >
          <Download aria-hidden="true" className="size-4 shrink-0" />
          {m.legalScreenExportAction({}, { locale })}
        </Button>
        <div aria-live="polite" id={statusId} role="status">
          {statusMessage && <p className="mt-2 text-sm">{statusMessage}</p>}
        </div>
      </div>
      <div className="mt-4 min-w-0">
        <button
          aria-controls={detailsId}
          aria-expanded={detailsOpen}
          className="inline-flex min-w-0 max-w-full items-start gap-1 break-words text-left text-sm leading-5 text-[#586c88] underline decoration-[#586c88]/40 underline-offset-4 hover:text-[#1f2d43] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
          onClick={() => {
            setDetailsOpen((open) => !open);
          }}
          type="button"
        >
          <ChevronDown
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 transition-transform ${
              detailsOpen ? "rotate-180" : ""
            }`}
          />
          {m.legalScreenExportSectionsLabel(
            { count: accountDataExportSections.length },
            { locale }
          )}
        </button>
        <div hidden={!detailsOpen} id={detailsId}>
          <ul className="mt-1 list-disc pl-5 text-sm leading-5 text-[#586c88]">
            {accountDataExportSections.map((section) => (
              <li key={section.path}>{sectionNameOf(section.path, locale)}</li>
            ))}
            <li>{m.legalScreenExportSectionManifest({}, { locale })}</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
