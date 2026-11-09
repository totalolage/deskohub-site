import "server-only";

import { Data, Effect, Layer } from "effect";
import { isLocale } from "@/features/i18n";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import { defineWorkspaceRoute } from "@/shared/backend/workspace-route";
import { createDownloadResponse } from "@/shared/utils/download-response";
import { markPrivateResponse } from "@/shared/utils/private-response";
import { AccountDataExportService } from "./backend/account-data-export.service";

/** The service the route reads, live unless a test provides a fake. */
type AccountDataExportServiceLayer = Layer.Layer<
  AccountDataExportService,
  unknown
>;

type AccountDataExportParams = {
  readonly params: Promise<{ readonly locale: string }>;
};

/**
 * `GET /[locale]/account/data-export`: the signed-in customer's data archive
 * as a ZIP attachment. Every response is private.
 */
export const makeAccountDataExportGet = (
  service: AccountDataExportServiceLayer = AccountDataExportService.Live
) =>
  defineWorkspaceRoute(
    {
      operation: "account.data-export",
      cancellation: "interrupt-on-disconnect",
      caller: "client",
      // A shared runtime that can't be built fails before the handler runs,
      // so `answerUnexpected` can't see it; it still gets the private 500.
      fallback: {
        failureCode: "account.data-export",
        response: () => loadFailedResponse(),
      },
    },
    (_request: Request, { params }: AccountDataExportParams) =>
      Effect.promise(() => params).pipe(
        Effect.filterOrFail(
          ({ locale }) => isLocale(locale),
          () => new AccountDataExportRouteNotFound()
        ),
        // Provided only once the locale passed, so an invalid locale is
        // refused even when the service can't be built. A build failure
        // becomes a defect, which `answerUnexpected` answers.
        Effect.andThen(
          Effect.flatMap(
            AccountDataExportService,
            (exports) => exports.download
          ).pipe(Effect.provide(Layer.orDie(service)))
        ),
        Effect.map(({ bytes, fileName }) =>
          createDownloadResponse({
            body: Uint8Array.from(bytes),
            contentType: "application/zip",
            filename: fileName,
          })
        ),
        Effect.catchTags({
          AccountDataExportRouteNotFound: answerNotFound,
          AccountDataExportUnavailableError: answerNotFound,
          AccountDataExportLoadError: answerLoadFailed,
        }),
        answerUnexpected
      )
  );

/** The route's own parameters can't name an account archive. */
class AccountDataExportRouteNotFound extends Data.TaggedError(
  "AccountDataExportRouteNotFound"
) {}

/*
 * Every refusal (signed out, unverified, no linked customer, a review
 * account, deletion pending, an invalid locale) answers the same private 404
 * without a body. A load failure answers a private generic 500 without any
 * archive bytes; the service already logged its fixed code. Anything else,
 * such as a service that couldn't be built, logs only this route's code; a
 * shared runtime that couldn't be built gets the same private 500 through the
 * route's fallback. An interruption (the client disconnected) stays an
 * interruption.
 */
const answerNotFound = () => Effect.sync(notFoundResponse);

const answerLoadFailed = () => Effect.sync(loadFailedResponse);

const answerUnexpected = catchRecoverableCause(() =>
  Effect.logError("Account data export failed", {
    failureCode: "account.data-export",
  }).pipe(Effect.andThen(Effect.sync(loadFailedResponse)))
);

const notFoundResponse = () =>
  markPrivateResponse(new Response(null, { status: 404 }));

const loadFailedResponse = () =>
  markPrivateResponse(
    Response.json(
      { error: "Account data export could not be assembled." },
      { status: 500 }
    )
  );
