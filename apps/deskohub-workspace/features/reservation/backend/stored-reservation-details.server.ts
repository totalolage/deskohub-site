import "server-only";

import { type SQL, sql } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import {
  type WorkspaceReservationRow,
  workspaceReservations,
} from "@/db/schema";
import { quotedSqlList } from "@/db/schema/sql-list";
import {
  storedWorkspaceReservationDetailsSchema,
  type WorkspaceReservationId,
} from "@/features/reservation/persistence-contracts";
import {
  type WorkspaceReservationKind,
  workspaceReservationKindSchema,
} from "@/features/reservation/reservation-kind";
import type { ReservationProductPropertyIds } from "@/features/reservation/reservation-product-descriptor";

export class WorkspaceReservationDetailsMalformedError extends Data.TaggedError(
  "WorkspaceReservationDetailsMalformedError"
)<{
  readonly reservationId: WorkspaceReservationId;
  readonly message: string;
  readonly cause: unknown;
}> {}

/**
 * What the column holds. Its Drizzle type is the decoded document, but a value
 * written outside the encoder may not match it, so every reader decodes it.
 */
type StoredDocument = WorkspaceReservationRow["reservationDetails"];

const storedDetailsDecoder: Schema.Decoder<StoredDocument> =
  storedWorkspaceReservationDetailsSchema;

// Every reader accepts the same documents: a field the schema doesn't know
// fails the read instead of being dropped, so no write-back loses it.
const parseOptions = { errors: "all", onExcessProperty: "error" } as const;

const decodeDetails = Schema.decodeUnknownEffect(
  storedDetailsDecoder,
  parseOptions
);

const decode = Effect.fn("StoredReservationDetails.decode")(
  (reservationId: WorkspaceReservationId, raw: StoredDocument) =>
    decodeDetails(raw).pipe(
      Effect.mapError(
        (cause) =>
          new WorkspaceReservationDetailsMalformedError({
            reservationId,
            message: "Stored workspace reservation details are malformed.",
            cause,
          })
      )
    )
);

const projectDetails = Schema.decodeUnknownOption(
  storedDetailsDecoder,
  parseOptions
);

const details = workspaceReservations.reservationDetails;

// Each reads a field as its JSON type holds it, and null for any other type. A
// CASE runs its result only for the rows its condition admits, so no cast sees
// a value it can't convert.

/** A string or number field as text. */
const scalarTextAt = (field: SQL, type: "string" | "number") =>
  sql`case when jsonb_typeof(${field}) = ${sql.raw(`'${type}'`)}
    then ${field} #>> '{}' end`;

/** A boolean field. */
const booleanAt = (field: SQL) =>
  sql`case when jsonb_typeof(${field}) = 'boolean' then (${field})::boolean end`;

/** A whole number in the int range, every value the plain text cast read. */
const integerAt = (field: SQL) =>
  sql`case when jsonb_typeof(${field}) = 'number' then
    case when (${field})::numeric = trunc((${field})::numeric)
      and (${field})::numeric between -2147483648 and 2147483647
    then (${field})::numeric::int end
  end`;

/**
 * Where each catalog property lives in a document. A document that lacks the
 * field (a reservation the backfill couldn't resolve) or holds it in another
 * JSON type yields null, never a cast error.
 */
const propertyValues: {
  readonly [Family in WorkspaceReservationKind]: {
    readonly [Property in ReservationProductPropertyIds[Family]]: SQL;
  };
} = {
  cowork: {
    tier: scalarTextAt(sql`${details}->'entryTier'`, "string"),
    coffee: booleanAt(sql`${details}->'coffee'`),
    monitor: scalarTextAt(sql`${details}->'monitorOption'`, "string"),
  },
  "meeting-room": {
    offer: sql`${scalarTextAt(sql`${details}->'duration'->'unit'`, "string")} || ':' || ${scalarTextAt(sql`${details}->'duration'->'amount'`, "number")}`,
  },
  office: {
    seats: integerAt(sql`${details}->'seats'`),
    days: integerAt(sql`${details}->'dayCount'`),
  },
};

type RowWithDetails = Pick<
  WorkspaceReservationRow,
  "id" | "reservationDetails"
>;

const decodeRow = <Row extends RowWithDetails>(row: Row) =>
  decode(row.id, row.reservationDetails).pipe(
    Effect.map((reservationDetails) => ({ ...row, reservationDetails }))
  );

/**
 * The app-owned `reservation_details` document of a workspace reservation:
 * the one place that decodes it and knows its JSON layout. The accessors carry
 * no bound parameters, so a query can group by the expression it selects.
 */
export const StoredReservationDetails = {
  /** Reads a document whose malformation the read must report. */
  decode,

  /** Reads the document of a row read with its reservation's ID, keeping the rest of the row. */
  decodeRow,

  /** Reads the documents of rows, failing on the first malformed one. */
  decodeRows: <Row extends RowWithDetails>(rows: readonly Row[]) =>
    Effect.forEach(rows, decodeRow),

  /** Reads a document for a view that shows less, not fails, when it's malformed. */
  project: (raw: StoredDocument) => projectDetails(raw),

  /** The reservation's family, null when the document names none. */
  kind: sql<WorkspaceReservationKind | null>`case
    when ${details}->>'kind' in (${quotedSqlList(workspaceReservationKindSchema.literals)})
    then ${details}->>'kind' end`,

  /** A family's catalog property, null when the document lacks a readable value. */
  property: <Family extends WorkspaceReservationKind>(
    family: Family,
    property: ReservationProductPropertyIds[Family]
  ): SQL => propertyValues[family][property],

  /** Whether the reservation is a meeting room booked with early setup. */
  earlySetupMeetingRoom: sql<boolean>`${details} @> '{"kind":"meeting-room","earlySetup":true}'::jsonb`,
};
