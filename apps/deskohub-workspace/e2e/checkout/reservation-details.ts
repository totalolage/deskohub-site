import { isDeepStrictEqual } from "node:util";
import { Option, Schema } from "effect";
import {
  type StoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
} from "@/features/reservation/persistence-contracts";

const decodeStoredReservationDetails = Schema.decodeUnknownOption(
  storedWorkspaceReservationDetailsSchema,
  { onExcessProperty: "error" }
);

// Cowork details are the whole product intent, so they must match exactly.
// Meeting-room and office snapshots may carry optional product identity that
// the expectation leaves open, so only the keys it names must match.
export const matchesExpectedReservationDetails = (
  actual: unknown,
  expected: StoredWorkspaceReservationDetails
): boolean =>
  Option.match(decodeStoredReservationDetails(actual), {
    onNone: () => false,
    onSome: (stored) =>
      stored.kind === "cowork" || expected.kind === "cowork"
        ? isDeepStrictEqual(stored, expected)
        : Object.entries(expected).every(([key, value]) =>
            isDeepStrictEqual(stored[key as keyof typeof stored], value)
          ),
  });
