import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import type {
  EmailMessage,
  EmailProviderConfig,
  EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";

mock.module("server-only", () => ({}));
mock.module("osm", () => ({
  generateStaticMapImage: mock(() =>
    Effect.succeed(Buffer.from("workspace-location-map"))
  ),
  generateSvgPngBuffer: mock(() =>
    Promise.resolve(Buffer.from("workspace-table-map"))
  ),
}));

const customer: Customer = {
  _cloudId: "customer-id",
  firstName: "Ada",
  lastName: "Lovelace",
  companyName: null,
  email: "customer@example.com",
  phone: null,
  points: null,
  flags: "0",
  display: true,
  deleted: false,
};

const makeReservation = (
  overrides: Partial<WorkspaceReservationDetails>
): WorkspaceReservationDetails => ({
  id: "reservation-id",
  dotyposCustomerId: "dotypos-customer-id",
  dotyposReservationId: "dotypos-reservation-id",
  customerAccessCode: "1234",
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  customer,
  reservedFrom: Temporal.Instant.from("2026-06-12T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-12T11:00:00Z"),
  ...overrides,
});

const sentResult = (id: string): EmailSendResult => ({
  id,
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

describe("workspace reservation email details", () => {
  test("renders Basic cowork details without meeting-room-only rows", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const rows = createReservationRows(makeReservation({}), "en-US");

    expect(rows).toEqual([
      ["Entry tier", "Basic Day Pass"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Coffee", "No"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);
  });

  test("renders Profi cowork monitor details", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const rows = createReservationRows(
      makeReservation({
        reservationDetails: {
          kind: "cowork",
          entryTier: "profi",
          coffee: true,
          monitorOption: "2x27-qhd",
        },
      }),
      "en-US"
    );

    expect(rows).toEqual([
      ["Entry tier", "Profi Workstation"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Coffee", "Yes"],
      ["Monitors", "2x 27 QHD"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);
  });

  test("renders the Dotypos meeting-room interval without cowork details", async () => {
    const {
      createReservationRows,
      createWorkspaceReservationNotificationEmailPreviewHtml,
    } = await import("./workspace-reservation-email.service");
    const reservation = makeReservation({
      reservationDetails: { kind: "meeting-room" },
    });

    expect(createReservationRows(reservation, "en-US")).toEqual([
      ["Reservation", "Meeting Room"],
      ["Reservation date", "Friday, June 12, 2026"],
      ["Reservation time", "9:00 AM – 1:00 PM"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);

    const internalHtml = createWorkspaceReservationNotificationEmailPreviewHtml(
      { reservation }
    );

    expect(internalHtml).toContain("Zasedací místnost");
    expect(internalHtml).toContain("9:00–13:00");
    expect(internalHtml).not.toContain("Káva");
    expect(internalHtml).not.toContain("Monitory");
  });

  test("renders a DST whole-day meeting-room reservation as the calendar day", async () => {
    const { createReservationRows, WorkspaceReservationEmailService } =
      await import("./workspace-reservation-email.service");
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const reservation = makeReservation({
      reservationDetails: { kind: "meeting-room" },
      reservedFrom: Temporal.Instant.from("2027-03-27T23:00:00Z"),
      reservedUntil: Temporal.Instant.from("2027-03-28T22:00:00Z"),
    });

    expect(createReservationRows(reservation, "en-US")).toEqual([
      ["Reservation", "Meeting Room"],
      ["Reservation date", "Sunday, March 28, 2027"],
      ["Reservation time", "whole day"],
      ["Reservation reference", "dotypos-reservation-id"],
      ["Order reference", "reservation-id"],
    ]);

    const sentMessages: EmailMessage[] = [];
    const emailService: EmailService = {
      send: mock((message: EmailMessage) => {
        sentMessages.push(message);
        return Effect.succeed(sentResult(`email-${sentMessages.length}`));
      }),
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: "reservations@workspace.deskohub.cz",
        name: "Deskohub Workspace",
      },
    };

    await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      yield* service.sendPaidReservationEmails({ reservation });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Live
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(sentMessages).toHaveLength(2);
    const customerMessage = sentMessages[0];
    expect(customerMessage?.html).toContain("Sunday, March 28, 2027");
    expect(customerMessage?.html).toContain("whole day");
    expect(customerMessage?.text).toContain("Sunday, March 28, 2027");
    expect(customerMessage?.text).toContain("whole day");
    expect(customerMessage?.html).not.toContain("12:00 AM");
    expect(customerMessage?.text).not.toContain("12:00 AM");

    const internalMessage = sentMessages[1];
    expect(internalMessage?.html).toContain("neděle 28. března 2027");
    expect(internalMessage?.html).toContain("celý den");
    expect(internalMessage?.text).toContain("neděle 28. března 2027");
    expect(internalMessage?.text).toContain("celý den");
    expect(internalMessage?.html).not.toContain("0:00");
    expect(internalMessage?.text).not.toContain("0:00");
  });
});
