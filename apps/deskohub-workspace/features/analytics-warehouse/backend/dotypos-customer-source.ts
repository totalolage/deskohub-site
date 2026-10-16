import "server-only";

import {
  type CustomerChanges,
  CustomerVersionSelection,
  type DotyposCustomer,
  DotyposService,
  type DotyposTimestamp,
  DotyposTimestampFromString,
  DotyposTimestampSchema,
  dotyposTimestampFromDateTime,
  type ExternalAPIError,
  formatDotyposTimestamp,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import { isMatchingSecret } from "@deskohub/secret-comparison";
import {
  Array as Arr,
  Data,
  DateTime,
  Duration,
  Effect,
  Match,
  Option,
  Redacted,
  Schema,
} from "effect";
import { NextResponse } from "next/server";
import {
  RequestBudget,
  type RequestBudgetPolicy,
  type RequestBudgetUnavailable,
} from "@/shared/backend/request-budget/request-budget.service";
import { markPrivateResponse } from "@/shared/utils/private-response";
import { DotyposCustomerSourceAccess } from "./dotypos-customer-source-access.service";

/**
 * PostHog's Custom REST warehouse source pulls Dotypos customers from here so
 * analysts can join them to persons on `dotypos_customer_id`. Each request
 * reads one Dotypos page into memory and returns it; nothing is stored.
 * PostHog keeps the copy, merges rows on `id`, and starts each sync from the
 * highest `versionDate` it has seen.
 */
export const respondWithDotyposCustomerSource = (request: Request) =>
  readDotyposCustomerSourcePage(request).pipe(
    Effect.map((page) => NextResponse.json(page)),
    Effect.catchTags({
      DotyposCustomerSourceDisabled: () => rejectRequest(404, "Not found."),
      DotyposCustomerSourceUnauthorized: () =>
        rejectRequest(401, "Unauthorized.").pipe(
          Effect.map((response) => {
            response.headers.set("WWW-Authenticate", "Bearer");
            return response;
          })
        ),
      InvalidDotyposCustomerSourceQuery: () =>
        rejectRequest(400, "Invalid since or cursor."),
      DotyposCustomerExportBudgetExhausted: ({ retryAt }) =>
        deferRequest(retryAt),
      RequestBudgetUnavailable: (error) =>
        failUpstream(error, 503, "The export budget is unavailable."),
      ExternalAPIError: (error) =>
        error.statusCode === 429
          ? failUpstream(error, 429, "Dotypos is rate limiting requests.").pipe(
              Effect.map(
                withRetryAfter(Duration.toSeconds(dotyposRateLimitBackoff))
              )
            )
          : failUpstream(error, 502, unavailableMessage),
      NetworkError: (error) => failUpstream(error, 502, unavailableMessage),
      ValidationError: (error) => failUpstream(error, 502, unavailableMessage),
      UnexpectedDotyposCustomerPage: (error) =>
        failUpstream(error, 502, unavailableMessage),
      UnpageableDotyposCustomerGroup: (error) =>
        failUpstream(error, 502, unavailableMessage),
    }),
    Effect.map(markPrivateResponse)
  );

/**
 * The export's share of the Dotypos rate limit, which live bookings use too.
 * Dotypos allows 150 requests per 30 minutes; the export may spend 3 per
 * rolling 3 minutes, about 30 per 30 minutes. A short window keeps every
 * `Retry-After` under PostHog's 300-second cap, so PostHog waits and retries
 * instead of failing the sync. Tune the rate with `limit`, and keep `window`
 * at 5 minutes or less.
 */
export const dotyposCustomerExportBudget: RequestBudgetPolicy = {
  key: "dotypos-customer-export",
  limit: 3,
  window: Duration.minutes(3),
};

/** How long PostHog waits after Dotypos itself rate-limits a page. */
const dotyposRateLimitBackoff = Duration.minutes(1);

const NullableString = Schema.NullOr(Schema.String);

/**
 * The only customer fields that leave Dotypos. Notes, header prints, barcodes,
 * company and VAT numbers, external and seller IDs, flags, and display
 * settings stay behind.
 */
const DotyposCustomerSourceRowSchema = Schema.Struct({
  id: Schema.String,
  firstName: NullableString,
  lastName: NullableString,
  companyName: NullableString,
  email: NullableString,
  phone: NullableString,
  addressLine1: NullableString,
  addressLine2: NullableString,
  city: NullableString,
  zip: NullableString,
  country: NullableString,
  birthday: NullableString,
  _discountGroupId: NullableString,
  points: NullableString,
  tags: Schema.NullOr(Schema.Array(Schema.String)),
  created: NullableString,
  versionDate: NullableString,
  deleted: Schema.Boolean,
}).annotate({
  identifier: "DotyposCustomerSourceRow",
  description: "The allowlisted Dotypos customer fields exported to PostHog.",
});
type DotyposCustomerSourceRow = typeof DotyposCustomerSourceRowSchema.Type;

const DotyposCustomerSourcePageSchema = Schema.Struct({
  results: Schema.Array(DotyposCustomerSourceRowSchema),
  next_cursor: NullableString,
}).annotate({
  identifier: "DotyposCustomerSourcePage",
  description:
    "One page of Dotypos customers; `next_cursor` is null after the last page.",
});
type DotyposCustomerSourcePage = typeof DotyposCustomerSourcePageSchema.Type;

/**
 * Where the next page starts. Every request reads the first Dotypos page of a
 * selection, and positions move by narrowing the selection, never by page
 * number: Dotypos can't sort customers by ID, so a page number into a list
 * whose order isn't unique could repeat or skip customers.
 *
 * - A range (`Dated`, `ChangedFrom`, `ChangedAfter`) is ordered by version
 *   date. Only whole version dates are served; the last one on a full page is
 *   read again from the next page's start.
 * - A group (`ChangedAt` one version date, or `Undated`) is ordered by
 *   `created` from `createdFrom` on, when a version date fills a whole page.
 *   Only whole creation times are served; the last one on a full page is read
 *   again from the next page's start.
 *
 * Dotypos stores both timestamps to the microsecond and filters at that
 * precision, so positions carry microseconds.
 */
type GroupSelection = Extract<
  CustomerVersionSelection,
  { readonly _tag: "ChangedAt" | "Undated" }
>;

/**
 * A first sync, which PostHog sends without `since`, starts with the undated
 * customers: incremental syncs can't reach them, and one that gains a version
 * date meanwhile still appears among the dated customers read after them.
 */
const firstSyncSelection: CustomerVersionSelection =
  CustomerVersionSelection.Undated({
    createdFrom: Option.none(),
  });

type StampedCustomer = {
  readonly customer: DotyposCustomer;
  readonly version: Option.Option<DotyposTimestamp>;
  readonly created: Option.Option<DotyposTimestamp>;
};

type IdentifiedStampedCustomer = StampedCustomer & {
  readonly customer: DotyposCustomer & {
    readonly id: NonNullable<DotyposCustomer["id"]>;
  };
};

type PageContinuation = {
  readonly served: readonly IdentifiedStampedCustomer[];
  readonly next: Option.Option<CustomerVersionSelection>;
};

class DotyposCustomerSourceDisabled extends Data.TaggedError(
  "DotyposCustomerSourceDisabled"
) {}

class DotyposCustomerSourceUnauthorized extends Data.TaggedError(
  "DotyposCustomerSourceUnauthorized"
) {}

class InvalidDotyposCustomerSourceQuery extends Data.TaggedError(
  "InvalidDotyposCustomerSourceQuery"
) {}

class DotyposCustomerExportBudgetExhausted extends Data.TaggedError(
  "DotyposCustomerExportBudgetExhausted"
)<{ readonly retryAt: DateTime.Utc }> {}

/**
 * Dotypos returned a page that breaks the requested selection or order: an
 * unreadable timestamp, a customer outside the selection, timestamps out of
 * order, or an empty page that claims more follow. Continuing could skip
 * customers silently.
 */
class UnexpectedDotyposCustomerPage extends Data.TaggedError(
  "UnexpectedDotyposCustomerPage"
) {}

/**
 * A whole page of a group shares one creation time, so no position can split
 * it without risking a skip.
 */
class UnpageableDotyposCustomerGroup extends Data.TaggedError(
  "UnpageableDotyposCustomerGroup"
) {}

const unavailableMessage = "Dotypos customers are unavailable.";

const readDotyposCustomerSourcePage = (request: Request) =>
  Effect.Do.pipe(
    Effect.bind("access", () => Effect.service(DotyposCustomerSourceAccess)),
    Effect.tap(({ access }) => authorizeRequest({ request, access })),
    Effect.bind("selection", () => readSourceSelection(request)),
    Effect.tap(() => spendExportBudget),
    Effect.bind("changes", ({ selection }) => listCustomerChanges(selection)),
    Effect.bind("page", toSourcePage),
    Effect.tap(({ selection, page }) =>
      Effect.logInfo("Dotypos customer source served a page", {
        position: selection._tag,
        rowCount: page.results.length,
        hasNextPage: page.next_cursor !== null,
      })
    ),
    Effect.flatMap(({ page }) =>
      Schema.encodeEffect(DotyposCustomerSourcePageSchema)(page).pipe(
        Effect.orDie
      )
    ),
    Effect.withSpan("DotyposCustomerSource.read")
  );

const bearerTokenPattern = /^Bearer\s+(\S+)$/i;

const authorizeRequest = (input: {
  readonly request: Request;
  readonly access: DotyposCustomerSourceAccess["Service"];
}): Effect.Effect<
  void,
  DotyposCustomerSourceDisabled | DotyposCustomerSourceUnauthorized
> =>
  Option.match(input.access.token, {
    onNone: () => Effect.fail(new DotyposCustomerSourceDisabled()),
    onSome: (token) =>
      Effect.succeed(
        bearerTokenPattern.exec(
          input.request.headers.get("authorization") ?? ""
        )
      ).pipe(
        Effect.filterOrFail(
          (presented) =>
            presented?.[1] !== undefined &&
            isMatchingSecret(presented[1], Redacted.value(token)),
          () => new DotyposCustomerSourceUnauthorized()
        ),
        Effect.asVoid
      ),
  });

const DotyposCustomerSourceQuerySchema = Schema.Struct({
  since: Schema.optionalKey(Schema.DateTimeUtcFromString),
  cursor: Schema.optionalKey(Schema.String),
});

/**
 * PostHog's `since` is read from its millisecond start, a superset of the
 * customers at or after the microsecond version date it stored.
 */
const readSourceSelection = (request: Request) =>
  Schema.decodeUnknownEffect(DotyposCustomerSourceQuerySchema)(
    Object.fromEntries(new URL(request.url).searchParams)
  ).pipe(
    Effect.map(({ since, cursor }) =>
      cursor === undefined
        ? Option.some(
            since === undefined
              ? firstSyncSelection
              : CustomerVersionSelection.ChangedFrom({
                  versionDate: dotyposTimestampFromDateTime(since),
                })
          )
        : decodeCursor(cursor)
    ),
    Effect.flatMap(Effect.fromOption),
    Effect.mapError(() => new InvalidDotyposCustomerSourceQuery())
  );

const spendExportBudget = Effect.service(RequestBudget).pipe(
  Effect.flatMap((budget) => budget.spend(dotyposCustomerExportBudget)),
  Effect.flatMap((spend) =>
    Match.valueTags(spend, {
      Granted: () => Effect.void,
      Exhausted: ({ retryAt }) =>
        Effect.fail(new DotyposCustomerExportBudgetExhausted({ retryAt })),
    })
  )
);

const listCustomerChanges = (selection: CustomerVersionSelection) =>
  Effect.service(DotyposService).pipe(
    Effect.flatMap((dotypos) => dotypos.listCustomerChanges({ selection }))
  );

const toSourcePage = (input: {
  readonly selection: CustomerVersionSelection;
  readonly changes: CustomerChanges;
}): Effect.Effect<
  DotyposCustomerSourcePage,
  UnexpectedDotyposCustomerPage | UnpageableDotyposCustomerGroup
> =>
  Effect.succeed(input).pipe(
    Effect.bind("customers", ({ changes }) =>
      Effect.forEach(changes.customers, readCustomerTimestamps)
    ),
    Effect.tap(checkSelectionOrder),
    Effect.bind("continuation", continueSelection),
    Effect.map(
      ({ continuation }): DotyposCustomerSourcePage => ({
        results: continuation.served.map(toSourceRow),
        next_cursor: Option.match(continuation.next, {
          onNone: () => null,
          onSome: encodeCursor,
        }),
      })
    )
  );

/** Dotypos marks an undated customer with a null or absent `versionDate`. */
const readTimestamp = (value: string | null | undefined) =>
  Option.match(Option.fromNullishOr(value), {
    onNone: () => Effect.succeedNone,
    onSome: (timestamp) =>
      Schema.decodeEffect(DotyposTimestampFromString)(timestamp).pipe(
        Effect.map(Option.some)
      ),
  });

const readCustomerTimestamps = (
  customer: DotyposCustomer
): Effect.Effect<IdentifiedStampedCustomer, UnexpectedDotyposCustomerPage> =>
  Effect.all({
    id: Effect.fromOption(Option.fromNullishOr(customer.id)),
    version: readTimestamp(customer.versionDate),
    created: readTimestamp(customer.created),
  }).pipe(
    Effect.map(({ id, version, created }) => ({
      customer: { ...customer, id },
      version,
      created,
    })),
    Effect.mapError(() => new UnexpectedDotyposCustomerPage())
  );

/**
 * Checks that Dotypos applied the selection's filter and order: positions are
 * only safe to advance when every customer is where the selection says.
 */
const checkSelectionOrder = (input: {
  readonly selection: CustomerVersionSelection;
  readonly customers: readonly StampedCustomer[];
}) =>
  Effect.succeed(input).pipe(
    Effect.filterOrFail(
      ({ selection, customers }) => isInSelectionOrder(selection, customers),
      () => new UnexpectedDotyposCustomerPage()
    ),
    Effect.asVoid
  );

const isInSelectionOrder = (
  selection: CustomerVersionSelection,
  customers: readonly StampedCustomer[]
) => {
  const versions = customers.map(({ version }) => version);
  const created = customers.map((customer) => customer.created);
  return Match.valueTags(selection, {
    Dated: () => isAscendingFrom(versions, Option.none()),
    ChangedFrom: ({ versionDate }) =>
      isAscendingFrom(versions, Option.some(versionDate)),
    ChangedAfter: ({ versionDate }) =>
      isAscendingFrom(versions, Option.some(versionDate + BigInt(1))),
    ChangedAt: ({ versionDate, createdFrom }) =>
      versions.every((version) => Option.contains(version, versionDate)) &&
      isAscendingFrom(created, createdFrom),
    Undated: ({ createdFrom }) =>
      versions.every(Option.isNone) && isAscendingFrom(created, createdFrom),
  });
};

/** Every timestamp is present, at least `lowest`, and at least the one before. */
const isAscendingFrom = (
  timestamps: readonly Option.Option<DotyposTimestamp>[],
  lowest: Option.Option<bigint>
) => {
  const present = Arr.getSomes(timestamps);
  return (
    present.length === timestamps.length &&
    present.every((timestamp, index) =>
      Option.match(
        index === 0 ? lowest : Option.fromNullishOr(present[index - 1]),
        {
          onNone: () => true,
          onSome: (previous) => timestamp >= previous,
        }
      )
    )
  );
};

const continueSelection = (input: {
  readonly selection: CustomerVersionSelection;
  readonly changes: CustomerChanges;
  readonly customers: readonly IdentifiedStampedCustomer[];
}): Effect.Effect<
  PageContinuation,
  UnexpectedDotyposCustomerPage | UnpageableDotyposCustomerGroup
> =>
  Match.valueTags(input.selection, {
    Dated: () => continueRange(input),
    ChangedFrom: () => continueRange(input),
    ChangedAfter: () => continueRange(input),
    ChangedAt: (selection) => continueGroup({ ...input, selection }),
    Undated: (selection) => continueGroup({ ...input, selection }),
  });

/**
 * Serves every whole version date on the page. When more pages follow, the
 * last version date may continue past this page, so it is held back and the
 * next page starts at it. A page holding a single version date can't hold it
 * back, so it is served and its version date is read as a group.
 */
const continueRange = (input: {
  readonly customers: readonly IdentifiedStampedCustomer[];
  readonly changes: CustomerChanges;
}): Effect.Effect<PageContinuation, UnexpectedDotyposCustomerPage> =>
  input.changes.hasMore
    ? holdBackLast(input.customers, ({ version }) => version).pipe(
        Effect.map(({ last, whole }) =>
          whole.length === 0
            ? {
                served: input.customers,
                next: Option.some(
                  CustomerVersionSelection.ChangedAt({
                    versionDate: last,
                    createdFrom: Option.none(),
                  })
                ),
              }
            : {
                served: whole,
                next: Option.some(
                  CustomerVersionSelection.ChangedFrom({
                    versionDate: last,
                  })
                ),
              }
        )
      )
    : Effect.succeed({ served: input.customers, next: Option.none() });

/**
 * Serves every whole creation time in the group page. When more pages follow,
 * the last creation time is held back and the next page starts at it. Then
 * the version dates after the group follow.
 *
 * Customers only leave a group whose version date is past: an edit moves them
 * to a newer version date, which the sync reaches later. Creation times don't
 * change, so a page boundary between two of them stays put.
 */
const continueGroup = (input: {
  readonly selection: GroupSelection;
  readonly customers: readonly IdentifiedStampedCustomer[];
  readonly changes: CustomerChanges;
}): Effect.Effect<
  PageContinuation,
  UnexpectedDotyposCustomerPage | UnpageableDotyposCustomerGroup
> =>
  input.changes.hasMore
    ? holdBackLast(input.customers, ({ created }) => created).pipe(
        Effect.filterOrFail(
          ({ whole }) => whole.length > 0,
          () => new UnpageableDotyposCustomerGroup()
        ),
        Effect.map(({ last, whole }) => ({
          served: whole,
          next: Option.some(
            Match.valueTags(input.selection, {
              ChangedAt: ({ versionDate }) =>
                CustomerVersionSelection.ChangedAt({
                  versionDate,
                  createdFrom: Option.some(last),
                }),
              Undated: () =>
                CustomerVersionSelection.Undated({
                  createdFrom: Option.some(last),
                }),
            })
          ),
        }))
      )
    : Effect.succeed({
        served: input.customers,
        next: Option.some(afterGroup(input.selection)),
      });

/**
 * Splits a full page before the last timestamp on it, which may continue on
 * the next page. A full page always ends in a timestamp; an empty one that
 * claims more pages follow is unexpected.
 */
const holdBackLast = <A extends StampedCustomer>(
  customers: readonly A[],
  timestampOf: (customer: StampedCustomer) => Option.Option<DotyposTimestamp>
) =>
  Effect.fromOption(
    Option.flatMap(Option.fromNullishOr(customers.at(-1)), timestampOf)
  ).pipe(
    Effect.mapError(() => new UnexpectedDotyposCustomerPage()),
    Effect.map((last) => ({
      last,
      whole: customers.filter((customer) =>
        Option.exists(timestampOf(customer), (timestamp) => timestamp < last)
      ),
    }))
  );

const afterGroup = (selection: GroupSelection): CustomerVersionSelection =>
  Match.valueTags(selection, {
    Undated: () => CustomerVersionSelection.Dated(),
    ChangedAt: ({ versionDate }) =>
      CustomerVersionSelection.ChangedAfter({
        versionDate,
      }),
  });

/**
 * Cursors are opaque to PostHog: `dated`, `from.<version>`, `after.<version>`,
 * `at.<version>[.<created>]`, and `undated[.<created>]`, with timestamps in
 * epoch microseconds.
 */
const encodeCursor = (selection: CustomerVersionSelection): string =>
  Match.valueTags(selection, {
    Dated: () => "dated",
    ChangedFrom: ({ versionDate }) => `from.${versionDate}`,
    ChangedAfter: ({ versionDate }) => `after.${versionDate}`,
    ChangedAt: ({ versionDate, createdFrom }) =>
      ["at", `${versionDate}`, ...Option.toArray(createdFrom).map(String)].join(
        "."
      ),
    Undated: ({ createdFrom }) =>
      ["undated", ...Option.toArray(createdFrom).map(String)].join("."),
  });

const timestampPattern = String.raw`(\d{1,16})`;

const cursorFormats: readonly {
  readonly pattern: RegExp;
  readonly decode: (
    groups: readonly (string | undefined)[]
  ) => CustomerVersionSelection;
}[] = [
  { pattern: /^dated$/, decode: () => CustomerVersionSelection.Dated() },
  {
    pattern: new RegExp(`^from\\.${timestampPattern}$`),
    decode: ([version]) =>
      CustomerVersionSelection.ChangedFrom({
        versionDate: timestampAt(version),
      }),
  },
  {
    pattern: new RegExp(`^after\\.${timestampPattern}$`),
    decode: ([version]) =>
      CustomerVersionSelection.ChangedAfter({
        versionDate: timestampAt(version),
      }),
  },
  {
    pattern: new RegExp(
      `^at\\.${timestampPattern}(?:\\.${timestampPattern})?$`
    ),
    decode: ([version, created]) =>
      CustomerVersionSelection.ChangedAt({
        versionDate: timestampAt(version),
        createdFrom: optionalTimestampAt(created),
      }),
  },
  {
    pattern: new RegExp(`^undated(?:\\.${timestampPattern})?$`),
    decode: ([created]) =>
      CustomerVersionSelection.Undated({
        createdFrom: optionalTimestampAt(created),
      }),
  },
];

const decodeCursor = (
  cursor: string
): Option.Option<CustomerVersionSelection> =>
  Option.firstSomeOf(
    cursorFormats.map(({ pattern, decode }) =>
      Option.fromNullishOr(pattern.exec(cursor)).pipe(
        Option.map((match) => decode(match.slice(1)))
      )
    )
  );

const timestampAt = (micros: string | undefined) =>
  DotyposTimestampSchema.make(BigInt(micros ?? "0"));

const optionalTimestampAt = (micros: string | undefined) =>
  Option.fromNullishOr(micros).pipe(Option.map(timestampAt));

const dotyposCustomerAnalyticsOptOutTag = "no-analytics";

/** Projects an identified customer onto the allowlist field by field. */
const toSourceRow = ({
  customer,
  version,
}: IdentifiedStampedCustomer): DotyposCustomerSourceRow => {
  const optedOut =
    customer.tags?.some(
      (tag) => tag.trim().toLowerCase() === dotyposCustomerAnalyticsOptOutTag
    ) ?? false;

  return {
    id: customer.id,
    firstName: optedOut ? null : (customer.firstName ?? null),
    lastName: optedOut ? null : (customer.lastName ?? null),
    companyName: optedOut ? null : (customer.companyName ?? null),
    email: optedOut ? null : (customer.email ?? null),
    phone: optedOut ? null : (customer.phone ?? null),
    addressLine1: optedOut ? null : (customer.addressLine1 ?? null),
    addressLine2: optedOut ? null : (customer.addressLine2 ?? null),
    city: optedOut ? null : (customer.city ?? null),
    zip: optedOut ? null : (customer.zip ?? null),
    country: optedOut ? null : (customer.country ?? null),
    birthday: optedOut ? null : (customer.birthday ?? null),
    _discountGroupId: optedOut ? null : (customer._discountGroupId ?? null),
    points: optedOut ? null : customer.points,
    tags: optedOut ? null : (customer.tags ?? null),
    created: customer.created ?? null,
    versionDate: Option.match(version, {
      onNone: () => null,
      onSome: formatDotyposTimestamp,
    }),
    deleted: optedOut || customer.deleted,
  };
};

const rejectRequest = (status: 400 | 401 | 404, message: string) =>
  Effect.logWarning("Dotypos customer source rejected a request", {
    statusCode: status,
  }).pipe(Effect.as(NextResponse.json({ error: message }, { status })));

/**
 * Answers 429 without calling Dotypos while the export budget is spent.
 * PostHog waits for `Retry-After` before it asks again.
 */
const deferRequest = (retryAt: DateTime.Utc) =>
  DateTime.now.pipe(
    Effect.map((now) =>
      Math.max(
        1,
        Math.ceil(Duration.toSeconds(DateTime.distance(now, retryAt)))
      )
    ),
    Effect.tap((retryAfterSeconds) =>
      Effect.logInfo("Dotypos customer source deferred a request", {
        statusCode: 429,
        retryAfterSeconds,
      })
    ),
    Effect.map((retryAfterSeconds) =>
      withRetryAfter(retryAfterSeconds)(
        NextResponse.json(
          { error: "The export budget is spent; retry later." },
          { status: 429 }
        )
      )
    )
  );

const withRetryAfter = (seconds: number) => (response: NextResponse) => {
  response.headers.set("Retry-After", `${seconds}`);
  return response;
};

/**
 * Logs only the failure's tag and status code: Dotypos failures can carry
 * customer values in their causes. PostHog retries 429 and 5xx answers.
 */
const failUpstream = (
  error:
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | RequestBudgetUnavailable
    | UnexpectedDotyposCustomerPage
    | UnpageableDotyposCustomerGroup,
  status: 429 | 502 | 503,
  message: string
) =>
  Effect.logError("Dotypos customer source could not read Dotypos", {
    errorTag: error._tag,
    upstreamStatusCode: "statusCode" in error ? error.statusCode : undefined,
    statusCode: status,
  }).pipe(Effect.as(NextResponse.json({ error: message }, { status })));
