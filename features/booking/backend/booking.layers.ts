import { ConfigProvider, Effect, Layer } from "effect";
import { effectFeatures } from "@/shared/backend/config/effect-features";
import { BookingServiceLive } from "./booking.service";
import { BookingStorageLive } from "./booking.storage";
import { DotyposService, DotyposServiceLive } from "./dotypos.service";
import { EmailService, EmailServiceLive } from "./email.service";

// Mock services for when API keys are not available
const DotyposServiceMock = Layer.succeed(
  DotyposService,
  DotyposService.of({
    createReservation: (booking) => {
      const mockId = `mock-${Date.now()}`;
      console.log(
        `[Mock Dotypos] Creating reservation ${mockId} for ${booking.name}`
      );
      return Effect.succeed({
        id: mockId,
        customer: {
          name: booking.name,
          email: booking.email,
          phone: booking.phone,
        },
        dateTime: booking.datetime.toISOString(),
        persons: booking.guestCount,
        status: "confirmed",
      });
    },
    getReservation: (id) => {
      console.log(`[Mock Dotypos] Getting reservation ${id}`);
      return Effect.succeed({
        id,
        customer: { name: "Mock Customer" },
        dateTime: new Date().toISOString(),
        persons: 1,
        status: "confirmed",
      });
    },
    updateReservation: (id, booking) => {
      console.log(`[Mock Dotypos] Updating reservation ${id}`);
      return Effect.succeed({
        id,
        customer: { name: booking.name || "Mock Customer" },
        dateTime: booking.datetime?.toISOString() || new Date().toISOString(),
        persons: booking.guestCount || 1,
        status: "confirmed",
      });
    },
    cancelReservation: (id) => {
      console.log(`[Mock Dotypos] Cancelling reservation ${id}`);
      return Effect.succeed(undefined);
    },
  })
);

const EmailServiceMock = Layer.succeed(
  EmailService,
  EmailService.of({
    sendReservationConfirmation: (booking, reservation) => {
      console.log(
        `[Mock Email] Would send reservation confirmation to ${booking.email} for reservation ${reservation.id}`
      );
      return Effect.succeed(undefined);
    },
    sendReservationNotification: (_booking, reservation) => {
      console.log(
        `[Mock Email] Would send staff notification for reservation ${reservation.id}`
      );
      return Effect.succeed(undefined);
    },
    sendEmail: (message) => {
      console.log(
        `[Mock Email] Would send email to ${message.to} with subject: ${message.subject}`
      );
      return Effect.succeed(undefined);
    },
  })
);

// Configuration layer that provides environment config
const ConfigLive = Layer.setConfigProvider(ConfigProvider.fromEnv());

// Composite layer that includes all booking dependencies
const ServicesLive = Layer.mergeAll(
  BookingStorageLive,
  effectFeatures.dotyposEnabled ? DotyposServiceLive : DotyposServiceMock,
  effectFeatures.emailEnabled ? EmailServiceLive : EmailServiceMock
);

export const BookingLive = BookingServiceLive.pipe(
  Layer.provide(ServicesLive),
  Layer.provide(ConfigLive),
  Layer.orDie
);
