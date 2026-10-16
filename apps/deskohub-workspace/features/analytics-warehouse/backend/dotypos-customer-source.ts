import "server-only";

import {
  type DotyposCustomer,
  DotyposService,
  type ExternalAPIError,
  type NetworkError,
  type ValidationError,
} from "@deskohub/dotypos";
import { Data, DateTime, Effect, Option, Redacted, Schema } from "effect";
import { NextResponse } from "next/server";
import { isMatchingSecret } from "@/shared/backend/utils/secret-comparison";
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
      ExternalAPIError: (error) =>
        error.statusCode === 429
          ? failUpstream(error, 429, "Dotypos is rate limiting requests.")
          : failUpstream(error, 502, unavailableMessage),
      NetworkError: (error) => failUpstream(error, 502, unavailableMessage),
      ValidationError: (error) => failUpstream(error, 502, unavailableMessage),
      InvalidDotyposCustomerVersion: (error) =>
        failUpstream(error, 502, unavailableMessage),
    }),
    Effect.map(markPrivateResponse)
  );

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
    "One page of Dotypos customers ordered by version date; `next_cursor` is null after the last page.",
});
type DotyposCustomerSourcePage = typeof DotyposCustomerSourcePageSchema.Type;

/**
 * A cursor names the page start as the last version date already served and
 * how many customers with exactly that version date were served. Resuming from
 * the version date, rather than a page number, keeps a customer edited during
 * a sync from shifting the rest of the list past the reader.
 */
const cursorPattern = /^(\d{1,15})?\.(\d{1,9})$/;

const DotyposCustomerSourceQuerySchema = Schema.Struct({
  since: Schema.optionalKey(Schema.DateTimeUtcFromString),
  cursor: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(cursorPattern))
  ),
});

/** Customers changed at or after `from` (epoch milliseconds), past `skip`. */
type SourcePosition = {
  readonly from: number | undefined;
  readonly skip: number;
};

type VersionedCustomer = {
  readonly customer: DotyposCustomer;
  readonly version: number | undefined;
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

class InvalidDotyposCustomerVersion extends Data.TaggedError(
  "InvalidDotyposCustomerVersion"
) {}

const unavailableMessage = "Dotypos customers are unavailable.";

const readDotyposCustomerSourcePage = Effect.fn("DotyposCustomerSource.read")(
  function* (request: Request) {
    const access = yield* DotyposCustomerSourceAccess;
    if (Option.isNone(access.token)) {
      return yield* new DotyposCustomerSourceDisabled();
    }
    if (
      !isAuthorizedRequest(
        request.headers.get("authorization"),
        access.token.value
      )
    ) {
      return yield* new DotyposCustomerSourceUnauthorized();
    }

    const position = yield* readSourcePosition(request);
    const dotypos = yield* DotyposService;
    const changes = yield* dotypos.listCustomerChanges(
      position.from === undefined
        ? { skip: position.skip }
        : {
            skip: position.skip,
            changedSince: DateTime.makeUnsafe(position.from),
          }
    );
    const customers = yield* Effect.forEach(
      changes.customers,
      readCustomerVersion
    );

    const page: DotyposCustomerSourcePage = {
      results: customers.flatMap(toSourceRow),
      next_cursor: changes.hasMore ? nextCursor(position, customers) : null,
    };
    yield* Effect.logInfo("Dotypos customer source served a page", {
      rowCount: page.results.length,
      hasNextPage: page.next_cursor !== null,
    });
    return yield* Schema.encodeEffect(DotyposCustomerSourcePageSchema)(
      page
    ).pipe(Effect.orDie);
  }
);

const bearerTokenPattern = /^Bearer\s+(\S+)$/i;

const isAuthorizedRequest = (
  authorization: string | null,
  token: Redacted.Redacted<string>
) => {
  const presented = bearerTokenPattern.exec(authorization ?? "")?.[1];
  return (
    presented !== undefined &&
    isMatchingSecret(presented, Redacted.value(token))
  );
};

const readSourcePosition = (request: Request) =>
  Schema.decodeUnknownEffect(DotyposCustomerSourceQuerySchema)(
    Object.fromEntries(new URL(request.url).searchParams)
  ).pipe(
    Effect.mapError(() => new InvalidDotyposCustomerSourceQuery()),
    Effect.map((query): SourcePosition => {
      const cursor = query.cursor && cursorPattern.exec(query.cursor);
      if (cursor) {
        return {
          from: cursor[1] === undefined ? undefined : Number(cursor[1]),
          skip: Number(cursor[2]),
        };
      }
      return {
        from:
          query.since === undefined
            ? undefined
            : DateTime.toEpochMillis(query.since),
        skip: 0,
      };
    })
  );

const readCustomerVersion = (
  customer: DotyposCustomer
): Effect.Effect<VersionedCustomer, InvalidDotyposCustomerVersion> => {
  if (customer.versionDate === undefined) {
    return Effect.succeed({ customer, version: undefined });
  }
  return Option.match(DateTime.make(customer.versionDate), {
    onNone: () => Effect.fail(new InvalidDotyposCustomerVersion()),
    onSome: (version) =>
      Effect.succeed({ customer, version: DateTime.toEpochMillis(version) }),
  });
};

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
          versionDate:
            version === undefined
              ? null
              : DateTime.formatIso(DateTime.makeUnsafe(version)),
          deleted: customer.deleted,
        },
      ];

/**
 * Dotypos orders the page by version date, so the next page starts after
 * the last version date served. When the whole page shares the start's
 * version date, the next page skips further into that same version date.
 */
const nextCursor = (
  position: SourcePosition,
  customers: readonly VersionedCustomer[]
): string | null => {
  const last = customers.at(-1);
  if (last === undefined) return null;

  const next: SourcePosition =
    last.version === position.from
      ? { from: position.from, skip: position.skip + customers.length }
      : {
          from: last.version,
          skip: customers.filter(({ version }) => version === last.version)
            .length,
        };
  return `${next.from ?? ""}.${next.skip}`;
};

const rejectRequest = (status: 400 | 401 | 404, message: string) =>
  Effect.logWarning("Dotypos customer source rejected a request", {
    statusCode: status,
  }).pipe(Effect.as(NextResponse.json({ error: message }, { status })));

/**
 * Logs only the failure's tag and status code: Dotypos failures can carry
 * customer values in their causes. PostHog retries 429 and 5xx answers.
 */
const failUpstream = (
  error:
    | ExternalAPIError
    | NetworkError
    | ValidationError
    | InvalidDotyposCustomerVersion,
  status: 429 | 502,
  message: string
) =>
  Effect.logError("Dotypos customer source could not read Dotypos", {
    errorTag: error._tag,
    upstreamStatusCode: "statusCode" in error ? error.statusCode : undefined,
    statusCode: status,
  }).pipe(Effect.as(NextResponse.json({ error: message }, { status })));
