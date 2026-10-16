import "server-only";

import { Effect, Layer, Result } from "effect";
import { cache } from "react";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { getMarketingPreferenceStatus } from "@/features/legal/marketing-preferences";
import type { CoworkReservationInput } from "@/features/reservation/cowork-reservation";
import type { MeetingRoomReservationInput } from "@/features/reservation/meeting-room-reservation";
import { getMeetingRoomReservationDuration } from "@/features/reservation/meeting-room-reservation-duration";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import type { ReservationExistingCustomer } from "@/features/reservation/reservation-existing-customer";
import type { WorkspaceReservationKind } from "@/features/reservation/reservation-kind";
import {
  getMeetingRoomAvailabilityQuery,
  isCoworkOfferAvailable,
  isMeetingRoomAvailable,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { CustomerLastReservationService } from "./customer-last-reservation.service";
import { WorkspaceAvailabilityService } from "./workspace-availability.service";

/**
 * The signed-in, linked customer a reservation page books for by default,
 * with their latest reservation of the page's family. Anonymous visits and
 * any account failure render the anonymous form.
 */
export const loadReservationExistingCustomer = cache(
  async <Kind extends WorkspaceReservationKind>(
    kind: Kind
  ): Promise<ReservationExistingCustomer<Kind> | undefined> => {
    const existingCustomer = await loadLinkedExistingCustomer(kind).pipe(
      Effect.provide(
        Layer.mergeAll(
          CustomerAccountContactService.Live,
          CustomerLastReservationService.Live,
          CustomerMarketingConsentRepository.Live
        )
      ),
      Effect.tapError((error) =>
        error._tag === "CustomerAccountAccessError" &&
        error.reason === "not-configured"
          ? Effect.void
          : Effect.logError("Reservation account contact load failed", {
              error,
            })
      ),
      Effect.result,
      runWorkspaceEffect("reservation.existing-customer", { boundary: "page" })
    );

    return Result.isSuccess(existingCustomer)
      ? existingCustomer.success
      : undefined;
  }
);

/**
 * The profile, last-reservation, and marketing-consent reads each issue a
 * database query (the first two plus a Dotypos call), so a signed-in page load
 * holds at most three pool connections for this step.
 */
const linkedCustomerReadConcurrency = 3;

/**
 * The contact, the last reservation, and the marketing consent need only the
 * account's link, so they load concurrently once it resolves. The contact
 * decides the outcome: when it fails or cannot book, the others are discarded.
 */
export const loadLinkedExistingCustomer = Effect.fn(
  "reservation.loadLinkedExistingCustomer"
)(function* <Kind extends WorkspaceReservationKind>(kind: Kind) {
  const contacts = yield* CustomerAccountContactService;
  const account = yield* contacts.currentLinkedAccount;
  if (!account) return undefined;

  const lastReservations = yield* CustomerLastReservationService;
  const marketingConsents = yield* CustomerMarketingConsentRepository;
  const [contact, lastReservation, hasMarketingConsent] = yield* Effect.all(
    [
      contacts.linkedContact(account),
      // The remembered options only refine the defaults, so a failure keeps
      // the account card and falls back to the usual defaults.
      lastReservations.load(account.dotyposCustomerId, kind).pipe(
        Effect.tapError((error) =>
          Effect.logWarning("Customer last reservation load failed", {
            error,
          })
        ),
        Effect.orElseSucceed(() => null)
      ),
      // An unreadable consent keeps offering the optional checkbox, which
      // never overrides a stored consent or withdrawal.
      marketingConsents.get(account.dotyposCustomerId).pipe(
        Effect.map(
          (consent) => getMarketingPreferenceStatus(consent) === "active"
        ),
        Effect.tapError((error) =>
          Effect.logWarning("Customer marketing consent load failed", {
            error,
          })
        ),
        Effect.orElseSucceed(() => false)
      ),
    ],
    { concurrency: linkedCustomerReadConcurrency }
  );
  if (!contact) return undefined;

  return {
    contact: {
      name: contact.name,
      email: contact.email,
      phone: contact.phone,
    },
    hasMarketingConsent,
    ...(lastReservation && { lastReservation }),
  } satisfies ReservationExistingCustomer<Kind>;
});

/**
 * Availability for a remembered reservation option. A failure is logged and
 * reads as unavailable so the form opens on the usual defaults instead.
 */
const loadRememberedOptionAvailability = (
  name: string,
  query: WorkspaceAvailabilityQuery
) =>
  Effect.flatMap(WorkspaceAvailabilityService, (service) =>
    service.getAvailability({ query })
  ).pipe(
    Effect.provide(WorkspaceAvailabilityService.Live),
    Effect.tapError((error) =>
      Effect.logWarning("Remembered reservation option availability failed", {
        error,
      })
    ),
    Effect.result,
    runWorkspaceEffect(name, { boundary: "page" })
  );

/** Whether a remembered cowork offer is still bookable on the form's date. */
export const isRememberedCoworkOfferAvailable = async ({
  date,
  entryTier,
  monitorOption,
}: Pick<CoworkReservationInput, "date" | "entryTier" | "monitorOption">) => {
  const offer = { date, entryTier, ...(monitorOption && { monitorOption }) };
  const availability = await loadRememberedOptionAvailability(
    "reservation.cowork.remembered-offer-availability",
    { kind: "cowork", from: date, to: date, ...offer }
  );

  return (
    Result.isSuccess(availability) &&
    isCoworkOfferAvailable(availability.success, offer)
  );
};

/** Whether the meeting room is free for a remembered duration. */
export const isRememberedMeetingRoomReservationAvailable = async ({
  duration,
  startDateTime,
}: Pick<MeetingRoomReservationInput, "duration" | "startDateTime">) => {
  const interval = getMeetingRoomReservationInterval(
    startDateTime,
    getMeetingRoomReservationDuration(duration)
  );
  if (!interval) return false;

  const availability = await loadRememberedOptionAvailability(
    "reservation.meeting-room.remembered-duration-availability",
    getMeetingRoomAvailabilityQuery(interval)
  );

  return (
    Result.isSuccess(availability) &&
    isMeetingRoomAvailable(availability.success)
  );
};
