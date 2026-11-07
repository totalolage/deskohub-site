import {
  CustomerBookingDateOutOfRange,
  type CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
  CustomerOfferingUnavailable,
} from "@deskohub/workspace-customer-api";
import { Effect, Match, Option, Schema } from "effect";
import {
  type BookingSelectionInput,
  BookingSelectionRejected,
  type BookingSelectionRejection,
} from "@/features/reservation/backend/booking-selection";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import {
  answerSessionApiFailure,
  type CustomerSessionApiFailure,
} from "./customer-api-failure";

const decodePlainDate = Schema.decodeUnknownOption(plainDateStringSchema);

/**
 * The selection a client sent, as the booking domain resolves it: its dates
 * as calendar dates, which the contract checks only for their format.
 */
export const toBookingSelectionInput = ({
  date,
  endDate,
  ...selection
}: CustomerBookingSelection): Effect.Effect<
  BookingSelectionInput,
  BookingSelectionRejected
> =>
  Effect.gen(function* () {
    const plainDate = (field: "date" | "endDate", value: string) =>
      Option.match(decodePlainDate(value), {
        onNone: () => Effect.fail(BookingSelectionRejected.invalidField(field)),
        onSome: Effect.succeed,
      });

    return {
      ...selection,
      date: yield* plainDate("date", date),
      ...(endDate !== undefined && {
        endDate: yield* plainDate("endDate", endDate),
      }),
    };
  });

/** The public error a selection the booking pages wouldn't accept answers with. */
const toSelectionRejectionAnswer = (reason: BookingSelectionRejection) =>
  Match.value(reason).pipe(
    Match.discriminatorsExhaustive("kind")({
      "invalid-field": ({ field }) =>
        new CustomerBookingSelectionInvalid({ field }),
      "date-out-of-range": ({ earliest, latest }) =>
        new CustomerBookingDateOutOfRange({ earliest, latest }),
      "office-closed": () =>
        new CustomerOfferingUnavailable({ family: "office" }),
    })
  );

/**
 * Answers a selection the booking pages wouldn't accept with its public
 * error, and every other failure, such as a price that can't be quoted, as
 * unavailable: a Calendar sale that can't be read is retried, never answered
 * as a changed price. Every endpoint that resolves a booking selection ends
 * in it.
 */
export const answerBookingSelectionFailure =
  (operation: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>) =>
    effect.pipe(
      Effect.catch(
        (
          failure
        ): Effect.Effect<
          never,
          | ReturnType<typeof toSelectionRejectionAnswer>
          | CustomerSessionApiFailure<Exclude<E, BookingSelectionRejected>>
        > =>
          failure instanceof BookingSelectionRejected
            ? Effect.fail(toSelectionRejectionAnswer(failure.reason))
            : Effect.fail(failure).pipe(answerSessionApiFailure(operation))
      )
    );
