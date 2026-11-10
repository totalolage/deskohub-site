import "server-only";

import { Effect, type Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import {
  type AccountDataExportAuthority,
  accountDataExportAuthorityLive,
  authorizeAccountDataExport,
} from "./backend/account-data-export.service";

/**
 * Whether the legal page offers the signed-in session its data archive:
 * exactly when the export route would serve it. A refusal, an unreadable
 * authority, or an authority that can't be built offers nothing.
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
    Effect.catchTag("AccountDataExportUnavailableError", () =>
      Effect.succeed(false)
    ),
    Effect.provide(authority),
    Effect.catch(() =>
      Effect.logWarning("Account data export availability is unreadable").pipe(
        Effect.as(false)
      )
    ),
    Effect.annotateLogs({ locale }),
    runWorkspaceEffect("account.data-export.availability", {
      boundary: "page",
    })
  );
