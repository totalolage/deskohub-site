"use client";

import { Download } from "lucide-react";
import { useCallback, useId, useState } from "react";
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
 * The self-service account data download. The browser-only fetch keeps error
 * handling in the page and the snapshot body out of logs and traces; the
 * document itself lives only in this response and the customer's browser.
 */
export function AccountDataExport({ locale }: { readonly locale: Locale }) {
  const [state, setState] = useState<ExportRequestState>({
    kind: "idle",
  });
  const statusId = useId();
  const pending = state.kind === "pending";

  const downloadExport = useCallback(async () => {
    setState({ kind: "pending" });
    try {
      const response = await fetch(`/${locale}/account/data-export`, {
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("export-unavailable");
      const blob = await response.blob();
      const filename = attachmentFilenameOf(
        response.headers.get("Content-Disposition"),
        `deskohub-account-data-${new Date().toISOString().slice(0, 10)}.json`
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
  );
}
