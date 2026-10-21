"use client";

import { Data, Effect, Schema } from "effect";
import { Download } from "lucide-react";
import { type MouseEvent, Suspense, use, useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { runWorkspaceBrowserEffect } from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import { Button } from "@/shared/components/ui/button";
import { localizeAdministrationHref } from "./administration-href";
import { m } from "./i18n";
import { administrationListSourceUnavailableCode } from "./list-export";
import { AdministrationAlert } from "./notice";

/** Why a list export failed. */
export type AdministrationListExportFailure =
  | "failed"
  | "signed-out"
  | "source-unavailable";

class AdministrationListExportError extends Data.TaggedError(
  "AdministrationListExportError"
)<{
  readonly reason: AdministrationListExportFailure;
  readonly cause?: unknown;
  readonly status?: number;
}> {}

const exportFailureCode = "administration.list-export.failed";

// A signed-out request is redirected to the sign-in page, which answers 200
// with HTML, so only a CSV attachment counts as the export.
const isCsvAttachment = (response: Response) =>
  /^text\/csv\b/i.test(response.headers.get("Content-Type") ?? "") &&
  /^attachment\b/i.test(response.headers.get("Content-Disposition") ?? "");

const getAttachmentFileName = (response: Response) =>
  /filename="([^"]+)"/.exec(
    response.headers.get("Content-Disposition") ?? ""
  )?.[1] ?? "export.csv";

const saveFile = ({
  blob,
  fileName,
}: {
  readonly blob: Blob;
  readonly fileName: string;
}) =>
  Effect.try({
    try: () => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = fileName;
      link.click();
      // Revoking right away can cancel the download in some browsers.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    catch: (cause) =>
      new AdministrationListExportError({ reason: "failed", cause }),
  });

const isSourceUnavailableBody = Schema.is(
  Schema.Struct({
    code: Schema.Literal(administrationListSourceUnavailableCode),
  })
);

// Only the export's own code means Dotypos is unavailable; the proxy also
// answers 503 when it can't read the session.
const failedExport = (response: Response) =>
  Effect.tryPromise(() => response.json()).pipe(
    Effect.map(
      (body): AdministrationListExportFailure =>
        isSourceUnavailableBody(body) ? "source-unavailable" : "failed"
    ),
    Effect.orElseSucceed((): AdministrationListExportFailure => "failed"),
    Effect.flatMap((reason) =>
      Effect.fail(
        new AdministrationListExportError({ reason, status: response.status })
      )
    )
  );

/** Downloads the export and answers `null`, or why it failed. */
const downloadListExport = (href: string) =>
  Effect.tryPromise({
    try: (signal) =>
      fetch(href, { cache: "no-store", credentials: "same-origin", signal }),
    catch: (cause) =>
      new AdministrationListExportError({ reason: "failed", cause }),
  }).pipe(
    Effect.filterOrElse((response) => response.ok, failedExport),
    Effect.filterOrFail(
      isCsvAttachment,
      (response) =>
        new AdministrationListExportError({
          reason: "signed-out",
          status: response.status,
        })
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.blob(),
        catch: (cause) =>
          new AdministrationListExportError({ reason: "failed", cause }),
      }).pipe(
        Effect.map((blob) => ({
          blob,
          fileName: getAttachmentFileName(response),
        }))
      )
    ),
    Effect.flatMap(saveFile),
    Effect.as(null),
    Effect.tapError((error) =>
      reportWorkspaceBrowserFailure(exportFailureCode, error)
    ),
    Effect.catchTag("AdministrationListExportError", ({ reason }) =>
      Effect.succeed(reason)
    ),
    Effect.catchDefect((defect) =>
      reportWorkspaceBrowserFailure(exportFailureCode, defect).pipe(
        Effect.as<AdministrationListExportFailure>("failed")
      )
    )
  );

/**
 * Downloads every row of an administration list that matches its current
 * filters as CSV. `href` is the unprefixed export path, resolved once the
 * list's filters are known. Without JavaScript, the link opens the file.
 * Each attempt reports its outcome through `onFailureChange`, so the caller
 * can show it with `AdministrationTableExportAlert` outside the controls.
 */
export function AdministrationTableExport({
  href,
  onFailureChange,
}: {
  readonly href: Promise<string>;
  readonly onFailureChange: (
    failure: AdministrationListExportFailure | null
  ) => void;
}) {
  return (
    <Suspense fallback={<ExportButtonPlaceholder />}>
      <ExportControl href={href} onFailureChange={onFailureChange} />
    </Suspense>
  );
}

/** Announces why the last export failed; stays mounted while it's empty. */
export function AdministrationTableExportAlert({
  failure,
}: {
  readonly failure: AdministrationListExportFailure | null;
}) {
  const locale = useRouteLocale();
  return (
    <div role="alert">
      {failure && (
        <AdministrationAlert className="mt-4" status="error">
          {{
            failed: m.administrationListExportFailed,
            "signed-out": m.administrationListExportSignedOut,
            "source-unavailable": m.administrationListExportSourceUnavailable,
          }[failure]({}, { locale })}
        </AdministrationAlert>
      )}
    </div>
  );
}

function ExportButtonPlaceholder() {
  const locale = useRouteLocale();
  return (
    <Button disabled size="sm" variant="secondary">
      <Download aria-hidden className="size-4" />
      {m.administrationListExportButton({}, { locale })}
    </Button>
  );
}

function ExportControl({
  href,
  onFailureChange,
}: {
  readonly href: Promise<string>;
  readonly onFailureChange: (
    failure: AdministrationListExportFailure | null
  ) => void;
}) {
  const locale = useRouteLocale();
  const exportHref = localizeAdministrationHref(use(href), locale);
  const [pending, setPending] = useState(false);

  const startExport = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    onFailureChange(null);
    void downloadListExport(exportHref)
      .pipe(runWorkspaceBrowserEffect("administration.list-export"))
      .then((reason) => {
        onFailureChange(reason);
        setPending(false);
      });
  };

  return (
    <Button asChild size="sm" variant="secondary">
      <a
        aria-disabled={pending}
        className={pending ? "pointer-events-none opacity-60" : undefined}
        href={exportHref}
        onClick={startExport}
      >
        <Download aria-hidden className="size-4" />
        {pending
          ? m.administrationListExportPending({}, { locale })
          : m.administrationListExportButton({}, { locale })}
      </a>
    </Button>
  );
}
