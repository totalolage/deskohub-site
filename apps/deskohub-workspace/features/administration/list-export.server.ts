import "server-only";

import { Effect, Match } from "effect";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { isLocale, type Locale } from "@/features/i18n";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";
import { type CsvColumn, createCsvDownloadResponse } from "@/shared/utils/csv";
import { getSearchParamsRecord } from "@/shared/utils/search-params";
import {
  AdministrationListSourceUnavailableError,
  AdministrationService,
} from "./administration.service";
import { administrationListSourceUnavailableCode } from "./list-export";
import type { AdministrationSearchParams } from "./page-data.server";

// An export that couldn't read Dotypos answers 503 with a stable code a client
// can explain; anything else is an internal failure.
const toExportFailure = Match.type<unknown>().pipe(
  Match.when(
    Match.instanceOf(AdministrationListSourceUnavailableError),
    WorkspaceRouteFailure.unavailable(
      "Dotypos details for the export are unavailable.",
      administrationListSourceUnavailableCode
    )
  ),
  Match.orElse(WorkspaceRouteFailure.internal("The export failed."))
);

// Like the proxy and the pages, the export doesn't reveal itself to anyone
// but an administrator.
const notFound = (cause: unknown) =>
  new WorkspaceRouteFailure({
    statusCode: 404,
    publicMessage: "Not found",
    cause,
  });

/**
 * A GET route under `/[locale]/admin/<list>/export` that downloads every row
 * the list's filters match, read from the same search params as the list page,
 * as a CSV file with headers in the route locale. Anyone but an administrator
 * gets a 404. When Dotypos details are unavailable it answers 503 with code
 * `administration_list_source_unavailable`, and never a partial file.
 */
export const defineAdministrationListExportRoute = <Row, E>({
  columns,
  name,
  rows,
}: {
  readonly columns: (locale: Locale) => readonly CsvColumn<Row>[];
  /** Names the operation and the file, such as `reservations`. */
  readonly name: string;
  readonly rows: (
    params: Awaited<AdministrationSearchParams>
  ) => Effect.Effect<readonly Row[], E, AdministrationService>;
}) =>
  defineWorkspaceRoute(
    {
      operation: `administration.${name}-export`,
      cancellation: "interrupt-on-disconnect",
      caller: "client",
    },
    (
      request: Request,
      { params }: { readonly params: Promise<{ readonly locale: string }> }
    ) =>
      Effect.Do.pipe(
        Effect.tap(() =>
          requireAdministratorAuthorization.pipe(Effect.mapError(notFound))
        ),
        Effect.bind("locale", () =>
          Effect.promise(() => params).pipe(
            Effect.map(({ locale }) => locale),
            Effect.filterOrFail(isLocale, () => notFound(undefined))
          )
        ),
        Effect.bind("rows", () =>
          rows(getSearchParamsRecord(new URL(request.url).searchParams)).pipe(
            Effect.provide(AdministrationService.Live),
            Effect.mapError(toExportFailure)
          )
        ),
        Effect.map(({ locale, rows }) =>
          createCsvDownloadResponse({
            columns: columns(locale),
            filename: `${name}-${getCurrentWorkspaceDate()}.csv`,
            rows,
          })
        )
      )
  );
