import { type AnalyticsController, analytics } from "./analytics";

/** How a customer signs in, as the site reports it. */
export type SignInMethod = "link" | "code" | "passkey";

/** The reservation families a booking can start in. */
export type ReservationKind = "cowork" | "meeting_room" | "office";

/**
 * The app's analytics events, one function each. Screens and features call
 * these rather than capturing raw event names.
 */
export const createAnalyticsEvents = (
  controller: Pick<AnalyticsController, "capture" | "screen">
) => ({
  /** A route was shown; pass the pathname only, never search params. */
  trackScreenView: (pathname: string) => controller.screen(pathname),
  trackSignInStarted: (method: SignInMethod) =>
    controller.capture({ name: "sign-in started", properties: { method } }),
  /** Sent once the signed-in identity is applied, attributed to the account. */
  trackSignInCompleted: (method: SignInMethod) =>
    controller.capture({
      name: "sign-in completed",
      properties: { method },
      awaitsAccount: true,
    }),
  trackBookingStarted: (reservationKind: ReservationKind) =>
    controller.capture({
      name: "booking started",
      properties: { reservation_kind: reservationKind },
    }),
  /** The booking was submitted; payment outcomes come from the server. */
  trackBookingSubmitted: (reservationKind: ReservationKind) =>
    controller.capture({
      name: "booking submitted",
      properties: { reservation_kind: reservationKind },
    }),
  trackAccessPinViewed: () => controller.capture({ name: "access PIN viewed" }),
  trackUpdateApplied: ({
    updateId,
    runtimeVersion,
  }: {
    readonly updateId?: string;
    readonly runtimeVersion?: string;
  }) =>
    controller.capture({
      name: "update applied",
      properties: {
        ...(updateId === undefined ? {} : { update_id: updateId }),
        ...(runtimeVersion === undefined
          ? {}
          : { runtime_version: runtimeVersion }),
      },
    }),
});

export const {
  trackScreenView,
  trackSignInStarted,
  trackSignInCompleted,
  trackBookingStarted,
  trackBookingSubmitted,
  trackAccessPinViewed,
  trackUpdateApplied,
} = createAnalyticsEvents(analytics);
