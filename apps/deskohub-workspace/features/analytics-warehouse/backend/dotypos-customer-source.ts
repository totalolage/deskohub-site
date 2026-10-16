import "server-only";

import {
  type CustomerChanges,
  type CustomerVersionSelection,
  type DotyposCustomer,
  DotyposService,
  type ExternalAPIError,
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
      UnexpectedDotyposCustomerVersion: (error) =>
        failUpstream(error, 502, unavailableMessage),
      UncountedDotyposCustomerGroup: (error) =>
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
 * Where the next page starts. Dotypos filters `versionDate` with `eq`, `gt`,
 * and `gteq` but can't compare customer IDs, so positions are keyed on version
 * dates:
 *
 * - `Range` reads the first Dotypos page of dated customers ordered by version
 *   date. Only whole version dates are served; the last one on a full page is
 *   read again from the next page's start.
 * - `Group` reads one version date, or the undated customers, page by page
 *   ordered by ID, when they fill a whole page. `size` is the group's count on
 *   its first page; a page reporting another count restarts the group, since
 *   an edit that moved a customer out would shift the remaining ones.
 */
type SourcePosition =
  | {
      readonly _tag: "Range";
      readonly selection: RangeSelection;
    }
  | {
      readonly _tag: "Group";
      readonly selection: GroupSelection;
      readonly page: number;
      readonly size: Option.Option<number>;
    };

type RangeSelection = Extract<
  CustomerVersionSelection,
  { readonly _tag: "Dated" | "ChangedFrom" | "ChangedAfter" }
>;

type GroupSelection = Extract<
  CustomerVersionSelection,
  { readonly _tag: "ChangedAt" | "Undated" }
>;

const rangeAt = (selection: RangeSelection): SourcePosition => ({
  _tag: "Range",
  selection,
});

const groupAt = (
  selection: GroupSelection,
  page = 1,
  size: Option.Option<number> = Option.none()
): SourcePosition => ({ _tag: "Group", selection, page, size });

/**
 * A first sync, which PostHog sends without `since`, starts with the undated
 * customers: incremental syncs can't reach them, and one that gains a version
 * date meanwhile still appears among the dated customers read after them.
 */
const firstSyncPosition = groupAt({ _tag: "Undated" });

type VersionedCustomer = {
  readonly customer: DotyposCustomer;
  readonly version: Option.Option<number>;
};

type PageContinuation = {
  readonly served: readonly VersionedCustomer[];
  readonly next: Option.Option<SourcePosition>;
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
 * Dotypos returned a customer whose version date is unreadable or outside the
 * requested selection and order. Continuing could skip customers silently.
 */
class UnexpectedDotyposCustomerVersion extends Data.TaggedError(
  "UnexpectedDotyposCustomerVersion"
) {}

/**
 * A group spans several pages but Dotypos didn't count it, so an edit that
 * shifted it between pages would go unnoticed.
 */
class UncountedDotyposCustomerGroup extends Data.TaggedError(
  "UncountedDotyposCustomerGroup"
) {}

const unavailableMessage = "Dotypos customers are unavailable.";

const readDotyposCustomerSourcePage = (request: Request) =>
  Effect.Do.pipe(
    Effect.bind("access", () => Effect.service(DotyposCustomerSourceAccess)),
    Effect.tap(({ access }) => authorizeRequest({ request, access })),
    Effect.bind("position", () => readSourcePosition(request)),
    Effect.tap(() => spendExportBudget),
    Effect.bind("changes", ({ position }) => listCustomerChanges(position)),
    Effect.bind("page", toSourcePage),
    Effect.tap(({ position, page }) =>
      Effect.logInfo("Dotypos customer source served a page", {
        position: position.selection._tag,
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

const readSourcePosition = (request: Request) =>
  Schema.decodeUnknownEffect(DotyposCustomerSourceQuerySchema)(
    Object.fromEntries(new URL(request.url).searchParams)
  ).pipe(
    Effect.map(({ since, cursor }) =>
      cursor === undefined
        ? Option.some(
            since === undefined
              ? firstSyncPosition
              : rangeAt({ _tag: "ChangedFrom", versionDate: since })
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

const listCustomerChanges = (position: SourcePosition) =>
  Effect.service(DotyposService).pipe(
    Effect.flatMap((dotypos) =>
      dotypos.listCustomerChanges({
        selection: position.selection,
        page: position._tag === "Group" ? position.page : 1,
      })
    )
  );

const toSourcePage = (input: {
  readonly position: SourcePosition;
  readonly changes: CustomerChanges;
}): Effect.Effect<
  DotyposCustomerSourcePage,
  UnexpectedDotyposCustomerVersion | UncountedDotyposCustomerGroup
> =>
  Effect.succeed(input).pipe(
    Effect.bind("customers", ({ changes }) =>
      Effect.forEach(changes.customers, readCustomerVersion)
    ),
    Effect.tap(checkSelectionOrder),
    Effect.bind("continuation", continuePosition),
    Effect.map(
      ({ continuation }): DotyposCustomerSourcePage => ({
        results: continuation.served.flatMap(toSourceRow),
        next_cursor: Option.match(continuation.next, {
          onNone: () => null,
          onSome: encodeCursor,
        }),
      })
    )
  );

const readCustomerVersion = (
  customer: DotyposCustomer
): Effect.Effect<VersionedCustomer, UnexpectedDotyposCustomerVersion> =>
  customer.versionDate === undefined
    ? Effect.succeed({ customer, version: Option.none() })
    : Effect.fromOption(DateTime.make(customer.versionDate)).pipe(
        Effect.map((version) => ({
          customer,
          version: Option.some(DateTime.toEpochMillis(version)),
        })),
        Effect.mapError(() => new UnexpectedDotyposCustomerVersion())
      );

/**
 * Checks that Dotypos applied the version filter and order: positions are
 * only safe to advance when every customer is where the selection says.
 */
const checkSelectionOrder = (input: {
  readonly position: SourcePosition;
  readonly customers: readonly VersionedCustomer[];
}) =>
  Effect.succeed(input.customers.map(({ version }) => version)).pipe(
    Effect.filterOrFail(
      (versions) => isInSelectionOrder(input.position.selection, versions),
      () => new UnexpectedDotyposCustomerVersion()
    ),
    Effect.asVoid
  );

const isInSelectionOrder = (
  selection: CustomerVersionSelection,
  versions: readonly Option.Option<number>[]
) =>
  Match.valueTags(selection, {
    Undated: () => versions.every(Option.isNone),
    ChangedAt: ({ versionDate }) =>
      versions.every((version) =>
        Option.contains(version, DateTime.toEpochMillis(versionDate))
      ),
    Dated: () => isAscending(versions, Number.NEGATIVE_INFINITY),
    ChangedFrom: ({ versionDate }) =>
      isAscending(versions, DateTime.toEpochMillis(versionDate)),
    ChangedAfter: ({ versionDate }) =>
      isAscending(versions, DateTime.toEpochMillis(versionDate) + 1),
  });

const isAscending = (
  versions: readonly Option.Option<number>[],
  lowest: number
) => {
  const dated = Arr.getSomes(versions);
  return (
    dated.length === versions.length &&
    dated.every((value, index) => value >= (dated[index - 1] ?? lowest))
  );
};

const continuePosition = (input: {
  readonly position: SourcePosition;
  readonly changes: CustomerChanges;
  readonly customers: readonly VersionedCustomer[];
}): Effect.Effect<PageContinuation, UncountedDotyposCustomerGroup> =>
  Match.valueTags(input.position, {
    Range: () => Effect.succeed(continueRange(input)),
    Group: (position) =>
      Effect.succeed({ ...input, position }).pipe(
        Effect.filterOrFail(
          (group) => hasGroupChanged(group) || isGroupCounted(group),
          () => new UncountedDotyposCustomerGroup()
        ),
        Effect.map(continueGroup)
      ),
  });

/**
 * Serves every whole version date on the page. When more pages follow, the
 * last version date may continue past this page, so it is held back and the
 * next page starts at it. A page holding a single version date can't hold it
 * back, so it is served and its version date is read as a group.
 */
const continueRange = (input: {
  readonly customers: readonly VersionedCustomer[];
  readonly changes: CustomerChanges;
}): PageContinuation => {
  const last = Option.flatten(
    Option.fromNullishOr(input.customers.at(-1)?.version)
  );
  if (!input.changes.hasMore || Option.isNone(last)) {
    return { served: input.customers, next: Option.none() };
  }
  const versionDate = DateTime.makeUnsafe(last.value);
  const wholeVersions = input.customers.filter(({ version }) =>
    Option.exists(version, (value) => value < last.value)
  );
  return wholeVersions.length === 0
    ? {
        served: input.customers,
        next: Option.some(groupAt({ _tag: "ChangedAt", versionDate })),
      }
    : {
        served: wholeVersions,
        next: Option.some(rangeAt({ _tag: "ChangedFrom", versionDate })),
      };
};

type GroupPage = {
  readonly position: Extract<SourcePosition, { readonly _tag: "Group" }>;
  readonly changes: CustomerChanges;
  readonly customers: readonly VersionedCustomer[];
};

/**
 * Customers only leave a group whose version date is past, so a count that
 * matches the group's first page means the pages so far covered the same
 * customers. An empty later page means the group shrank as well.
 */
const hasGroupChanged = ({ position, changes, customers }: GroupPage) =>
  Option.exists(position.size, (size) =>
    Option.match(changes.totalCount, {
      onNone: () => customers.length === 0,
      onSome: (count) => count !== size,
    })
  );

/** A group read in one page needs no count. */
const isGroupCounted = ({ position, changes }: GroupPage) =>
  Option.isSome(changes.totalCount) ||
  (!changes.hasMore && position.page === 1);

/**
 * Pages through a group by number, and restarts it from its first page when
 * its count changed. The customers already read are served either way;
 * PostHog merges repeats on `id`.
 */
const continueGroup = (group: GroupPage): PageContinuation => ({
  served: group.customers,
  next: Option.some(nextGroupPosition(group)),
});

const nextGroupPosition = ({ position, changes, customers }: GroupPage) => {
  if (hasGroupChanged({ position, changes, customers })) {
    return groupAt(position.selection);
  }
  if (changes.hasMore) {
    return groupAt(position.selection, position.page + 1, changes.totalCount);
  }
  return afterGroup(position.selection);
};

const afterGroup = (selection: GroupSelection): SourcePosition =>
  Match.valueTags(selection, {
    Undated: () => rangeAt({ _tag: "Dated" }),
    ChangedAt: ({ versionDate }) =>
      rangeAt({ _tag: "ChangedAfter", versionDate }),
  });

/**
 * Cursors are opaque to PostHog: `dated`, `from.<ms>`, `after.<ms>`,
 * `at.<ms>.<page>[.<size>]`, and `undated.<page>[.<size>]`, with version dates
 * in epoch milliseconds.
 */
const encodeCursor = (position: SourcePosition): string =>
  Match.valueTags(position, {
    Range: ({ selection }) =>
      Match.valueTags(selection, {
        Dated: () => "dated",
        ChangedFrom: ({ versionDate }) =>
          `from.${DateTime.toEpochMillis(versionDate)}`,
        ChangedAfter: ({ versionDate }) =>
          `after.${DateTime.toEpochMillis(versionDate)}`,
      }),
    Group: ({ selection, page, size }) =>
      [
        ...Match.valueTags(selection, {
          ChangedAt: ({ versionDate }) => [
            "at",
            `${DateTime.toEpochMillis(versionDate)}`,
          ],
          Undated: () => ["undated"],
        }),
        `${page}`,
        ...Option.match(size, {
          onNone: () => [],
          onSome: (count) => [`${count}`],
        }),
      ].join("."),
  });

const millisPattern = String.raw`(\d{1,15})`;
const groupPagePattern = String.raw`([1-9]\d{0,8})(?:\.(\d{1,9}))?`;

const cursorFormats: readonly {
  readonly pattern: RegExp;
  readonly decode: (groups: readonly string[]) => SourcePosition;
}[] = [
  { pattern: /^dated$/, decode: () => rangeAt({ _tag: "Dated" }) },
  {
    pattern: new RegExp(`^from\\.${millisPattern}$`),
    decode: ([millis]) =>
      rangeAt({ _tag: "ChangedFrom", versionDate: versionDateAt(millis) }),
  },
  {
    pattern: new RegExp(`^after\\.${millisPattern}$`),
    decode: ([millis]) =>
      rangeAt({ _tag: "ChangedAfter", versionDate: versionDateAt(millis) }),
  },
  {
    pattern: new RegExp(`^at\\.${millisPattern}\\.${groupPagePattern}$`),
    decode: ([millis, page, size]) =>
      groupAt(
        { _tag: "ChangedAt", versionDate: versionDateAt(millis) },
        Number(page),
        groupSize(size)
      ),
  },
  {
    pattern: new RegExp(`^undated\\.${groupPagePattern}$`),
    decode: ([page, size]) =>
      groupAt({ _tag: "Undated" }, Number(page), groupSize(size)),
  },
];

const decodeCursor = (cursor: string): Option.Option<SourcePosition> =>
  Option.firstSomeOf(
    cursorFormats.map(({ pattern, decode }) =>
      Option.fromNullishOr(pattern.exec(cursor)).pipe(
        Option.map((match) => decode(match.slice(1)))
      )
    )
  );

const versionDateAt = (millis: string | undefined) =>
  DateTime.makeUnsafe(Number(millis));

const groupSize = (size: string | undefined) =>
  Option.fromNullishOr(size).pipe(Option.map(Number));

/**
 * Projects a customer onto the allowlist field by field. A customer without
 * an ID can't be joined or merged, so it yields no row.
 */
const toSourceRow = ({
  customer,
  version,
}: VersionedCustomer): readonly DotyposCustomerSourceRow[] =>
  customer.id === undefined
    ? []
    : [
        {
          id: customer.id,
          firstName: customer.firstName ?? null,
          lastName: customer.lastName ?? null,
          companyName: customer.companyName ?? null,
          email: customer.email ?? null,
          phone: customer.phone ?? null,
          addressLine1: customer.addressLine1 ?? null,
          addressLine2: customer.addressLine2 ?? null,
          city: customer.city ?? null,
          zip: customer.zip ?? null,
          country: customer.country ?? null,
          birthday: customer.birthday ?? null,
          _discountGroupId: customer._discountGroupId ?? null,
          points: customer.points,
          tags: customer.tags ?? null,
          created: customer.created ?? null,
          versionDate: Option.match(version, {
            onNone: () => null,
            onSome: (millis) => DateTime.formatIso(DateTime.makeUnsafe(millis)),
          }),
          deleted: customer.deleted,
        },
      ];

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
    | UnexpectedDotyposCustomerVersion
    | UncountedDotyposCustomerGroup,
  status: 429 | 502 | 503,
  message: string
) =>
  Effect.logError("Dotypos customer source could not read Dotypos", {
    errorTag: error._tag,
    upstreamStatusCode: "statusCode" in error ? error.statusCode : undefined,
    statusCode: status,
  }).pipe(Effect.as(NextResponse.json({ error: message }, { status })));
