import "server-only";

import { Effect, type Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import {
  type AccountDataExportAuthority,
  accountDataExportAuthorityLive,
  authorizeAccountDataExport,
} from "./backend/account-data-export.service";

/**
 * Whether the legal page offers the signed-in session its data archive:
 * exactly when the export route would serve it. A refusal, an unreadable
 * authority, and any other failure, such as an authority or runtime that
 * can't be built, offer nothing.
 */
export const getAccountDataExportAvailability = (
  locale: Locale,
  authority: Layer.Layer<
    AccountDataExportAuthority,
    unknown
  > = accountDataExportAuthorityLive
): Promise<boolean> =>
  authorizeAccountDataExport.pipe(
    Effect.as(true),
    // An unreadable authority already logged its fixed code.
    Effect.catchTags({
      AccountDataExportUnavailableError: () => Effect.succeed(false),
      AccountDataExportLoadError: () => Effect.succeed(false),
    }),
    Effect.provide(authority),
    Effect.annotateLogs({ locale }),
    runWorkspaceEffectOrElse("account.data-export.availability", {
      boundary: "page",
      failureCode: "account.data-export.availability",
      orElse: () => false,
    })
  );
