import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
  type EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import { Effect, Layer } from "effect";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";

mock.module("server-only", () => ({}));

// The paid-fulfillment send path must never fetch the location map: fresh
// attachment bytes per attempt would break same-key idempotent retries. Track
// every hypothetical call and return different bytes each time so a regression
// cannot slip past the retry-stability assertions.
const staticMapImageCalls: Buffer[] = [];
mock.module("osm", () => ({
  generateStaticMapImage: mock(() => {
    const image = Buffer.from(
      `workspace-location-map-attempt-${staticMapImageCalls.length}`
    );
    staticMapImageCalls.push(image);
    return Effect.succeed(image);
  }),
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
  reservationDetails: {
    kind: "cowork",
    entryTier: "basic",
    coffee: false,
  },
  locale: "en-US",
  customer,
  reservedFrom: Temporal.Instant.from("2026-06-12T07:00:00Z"),
  reservedUntil: Temporal.Instant.from("2026-06-12T11:00:00Z"),
  seats: 1,
  ...overrides,
});

const sentResult = (id: string): EmailSendResult => ({
  id: EmailDeliveryIdSchema.make(id),
  status: "sent",
  provider: "test",
  timestamp: new Date(),
});

describe("createCustomerEmailInitialIdempotencyKey", () => {
  test("derives the stable provider reservation-and-category key", async () => {
    const {
      createCustomerEmailInitialIdempotencyKey,
      createCustomerEmailRecoveryIdempotencyKey,
    } = await import("./workspace-reservation-email.service");
    const { workspaceReservationIdSchema } = await import(
      "@/features/reservation/persistence-contracts"
    );
    const reservationId = workspaceReservationIdSchema.make("reservation-id");

    const key = createCustomerEmailInitialIdempotencyKey(reservationId);

    expect(key).toBe("workspace-paid-reservation-access-reservation-id");
    expect(key.length).toBeLessThanOrEqual(256);
    expect(key).toBe(createCustomerEmailInitialIdempotencyKey(reservationId));
    expect(key).not.toBe(
      createCustomerEmailRecoveryIdempotencyKey(
        EmailDeliveryIdSchema.make("accepted-customer-email-delivery")
      )
    );
  });
});

describe("createCustomerEmailRecoveryIdempotencyKey", () => {
  test("derives distinct stable keys for long prior delivery ids beyond the provider key limit", async () => {
    const { createCustomerEmailRecoveryIdempotencyKey } = await import(
      "./workspace-reservation-email.service"
    );
    const sharedLongPrefix = "resend-email-id".padEnd(213, "0");
    const firstPriorDeliveryId = EmailDeliveryIdSchema.make(
      `${sharedLongPrefix}first`
    );
    const secondPriorDeliveryId = EmailDeliveryIdSchema.make(
      `${sharedLongPrefix}second`
    );

    const firstKey =
      createCustomerEmailRecoveryIdempotencyKey(firstPriorDeliveryId);
    const secondKey = createCustomerEmailRecoveryIdempotencyKey(
      secondPriorDeliveryId
    );

    const legacyTruncationLength =
      `workspace-paid-reservation-access-recovery-${firstPriorDeliveryId}`
        .length;
    expect(legacyTruncationLength).toBeGreaterThan(256);
    expect(firstKey).toMatch(
      /^workspace-paid-reservation-access-recovery-[0-9a-f]{64}$/
    );
    expect(firstKey.length).toBeLessThanOrEqual(256);
    expect(secondKey.length).toBeLessThanOrEqual(256);
    expect(firstKey).not.toBe(secondKey);
    expect(firstKey).toBe(
      createCustomerEmailRecoveryIdempotencyKey(firstPriorDeliveryId)
    );
    expect(secondKey).toBe(
      createCustomerEmailRecoveryIdempotencyKey(secondPriorDeliveryId)
    );
  });
});

describe("workspace reservation email details", () => {
  test("renders Basic cowork details without meeting-room-only rows", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const rows = createReservationRows(makeReservation({}), "en-US");

    expect(rows).toEqual([
      { label: "Entry tier", value: "Basic Day Pass" },
      { label: "Reservation date", value: "Friday, June 12, 2026" },
      { label: "Coffee", value: "No" },
      {
        label: "Reservation reference",
        value: "dotypos-reservation-id",
      },
      { label: "Order reference", value: "reservation-id" },
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
      { label: "Entry tier", value: "Profi Workstation" },
      { label: "Reservation date", value: "Friday, June 12, 2026" },
      { label: "Coffee", value: "Yes" },
      { label: "Monitors", value: "2x 27 QHD" },
      {
        label: "Reservation reference",
        value: "dotypos-reservation-id",
      },
      { label: "Order reference", value: "reservation-id" },
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
      { label: "Reservation", value: "Meeting Room" },
      { label: "Reservation date", value: "Friday, June 12, 2026" },
      { label: "Reservation time", value: "9:00 AM – 1:00 PM" },
      {
        label: "Reservation reference",
        value: "dotypos-reservation-id",
      },
      { label: "Order reference", value: "reservation-id" },
    ]);

    const internalHtml =
      await createWorkspaceReservationNotificationEmailPreviewHtml({
        reservation,
      }).pipe(Effect.runPromise);

    expect(internalHtml).toContain("Zasedací místnost");
    expect(internalHtml).toContain("9:00–13:00");
    expect(internalHtml).not.toContain("Káva");
    expect(internalHtml).not.toContain("Monitory");
  });

  test("renders the inclusive office date range and seats", async () => {
    const { createReservationRows } = await import(
      "./workspace-reservation-email.service"
    );
    const reservation = makeReservation({
      reservationDetails: { kind: "office" },
      reservedFrom: Temporal.Instant.from("2026-06-11T22:00:00Z"),
      reservedUntil: Temporal.Instant.from("2026-06-14T22:00:00Z"),
      seats: 3,
    });

    expect(createReservationRows(reservation, "en-US")).toEqual([
      { label: "Reservation", value: "Private office" },
      {
        label: "Reservation date",
        value: "Friday, June 12 – Sunday, June 14, 2026",
      },
      { label: "Seats", value: "3" },
      {
        label: "Reservation reference",
        value: "dotypos-reservation-id",
      },
      { label: "Order reference", value: "reservation-id" },
    ]);
  });

  test("renders localized whole-day reservation and cancellation emails", async () => {
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
      { label: "Reservation", value: "Meeting Room" },
      { label: "Reservation date", value: "Sunday, March 28, 2027" },
      { label: "Reservation time", value: "whole day" },
      {
        label: "Reservation reference",
        value: "dotypos-reservation-id",
      },
      { label: "Order reference", value: "reservation-id" },
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

    const { env } = await import("@/env");
    const previousPreviewBypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    Object.assign(env, {
      VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-preview-bypass",
    });
    try {
      await Effect.gen(function* () {
        const service = yield* WorkspaceReservationEmailService;
        yield* service.sendPaidReservationEmails({ reservation });
        yield* service.sendCancellationEmail({ reservation });
      }).pipe(
        Effect.provide(
          WorkspaceReservationEmailService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(EmailServiceTag, emailService),
                Layer.succeed(EmailConfigTag, emailConfig),
                WorkspaceCheckoutNetworkDetailsService.Default
              )
            )
          )
        ),
        Effect.runPromise
      );
    } finally {
      Object.assign(env, {
        VERCEL_AUTOMATION_BYPASS_SECRET: previousPreviewBypassSecret,
      });
    }

    expect(sentMessages).toHaveLength(3);
    const customerMessage = sentMessages[0];
    expect(customerMessage?.attachments).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ contentType: "application/pdf" }),
      ])
    );
    expect(customerMessage?.html).toContain("Sunday, March 28, 2027");
    expect(customerMessage?.html).toContain("whole day");
    expect(customerMessage?.text).toContain("Sunday, March 28, 2027");
    expect(customerMessage?.text).toContain("whole day");
    expect(customerMessage?.html).not.toContain("12:00 AM");
    expect(customerMessage?.text).not.toContain("12:00 AM");
    expect(customerMessage?.html).toContain("/reservation/access/");
    expect(customerMessage?.text).toContain("/reservation/access/");
    expect(customerMessage?.html).toContain("/reservation/invoice/");
    expect(customerMessage?.text).toContain("/reservation/invoice/");
    expect(customerMessage?.html).toContain("accessToken=");
    expect(customerMessage?.text).toContain("accessToken=");
    expect(customerMessage?.html).not.toContain("statusToken=");
    expect(customerMessage?.text).not.toContain("statusToken=");
    expect(customerMessage?.html).toContain("x-vercel-protection-bypass=");
    expect(customerMessage?.text).toContain("x-vercel-protection-bypass=");
    expect(customerMessage?.html).toContain("x-vercel-set-bypass-cookie=true");
    expect(customerMessage?.text).toContain("x-vercel-set-bypass-cookie=true");
    expect(customerMessage?.html).not.toContain(">1234<");
    expect(customerMessage?.text).not.toContain("1234");

    const internalMessage = sentMessages[1];
    expect(internalMessage?.html).toContain("neděle 28. března 2027");
    expect(internalMessage?.html).toContain("celý den");
    expect(internalMessage?.text).toContain("neděle 28. března 2027");
    expect(internalMessage?.text).toContain("celý den");
    expect(internalMessage?.html).not.toContain("0:00");
    expect(internalMessage?.text).not.toContain("0:00");

    const cancellationMessage = sentMessages[2];
    expect(cancellationMessage?.subject).toBe(
      "Your Deskohub Workspace reservation was cancelled"
    );
    expect(cancellationMessage?.tags).toEqual([
      "workspace-reservation-cancellation",
    ]);
    expect(cancellationMessage?.metadata?.workspaceReservationId).toBe(
      reservation.id
    );
    expect(cancellationMessage?.html).toContain("Sunday, March 28, 2027");
    expect(cancellationMessage?.html).not.toContain("accessToken=");
    expect(cancellationMessage?.text).not.toContain("1234");
  });
});

describe("sendPaidReservationEmails idempotency", () => {
  test("passes the explicit initial customer key to the provider message only", async () => {
    const {
      createCustomerEmailInitialIdempotencyKey,
      WorkspaceReservationEmailService,
    } = await import("./workspace-reservation-email.service");
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const reservation = makeReservation({});
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

    const { env } = await import("@/env");
    const previousPreviewBypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    Object.assign(env, {
      VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-preview-bypass",
    });
    try {
      await Effect.gen(function* () {
        const service = yield* WorkspaceReservationEmailService;
        yield* service.sendPaidReservationEmails({
          reservation,
          customerEmailIdempotencyKey: createCustomerEmailInitialIdempotencyKey(
            reservation.id
          ),
        });
      }).pipe(
        Effect.provide(
          WorkspaceReservationEmailService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(EmailServiceTag, emailService),
                Layer.succeed(EmailConfigTag, emailConfig),
                WorkspaceCheckoutNetworkDetailsService.Default
              )
            )
          )
        ),
        Effect.runPromise
      );
    } finally {
      Object.assign(env, {
        VERCEL_AUTOMATION_BYPASS_SECRET: previousPreviewBypassSecret,
      });
    }

    expect(sentMessages).toHaveLength(2);
    const [customerMessage, internalMessage] = sentMessages;
    expect(customerMessage?.tags).toEqual([
      "workspace-paid-reservation-access",
    ]);
    expect(customerMessage?.metadata?.workspaceReservationId).toBe(
      reservation.id
    );
    expect(customerMessage?.idempotencyKey).toBe(
      "workspace-paid-reservation-access-reservation-id"
    );
    expect(internalMessage?.idempotencyKey).toBeUndefined();
  });
});

describe("sendPaidReservationEmails idempotent retry stability", () => {
  test("sends byte-identical complete customer requests under one idempotency key while the clock advances", async () => {
    const {
      createCustomerEmailInitialIdempotencyKey,
      WorkspaceReservationEmailService,
    } = await import("./workspace-reservation-email.service");
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const reservation = makeReservation({});
    const idempotencyKey = createCustomerEmailInitialIdempotencyKey(
      reservation.id
    );
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

    const { env } = await import("@/env");
    const previousPreviewBypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    const originalDateNow = Date.now;
    Object.assign(env, {
      VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-preview-bypass",
    });
    try {
      const sendOnce = () =>
        Effect.gen(function* () {
          const service = yield* WorkspaceReservationEmailService;
          yield* service.sendPaidReservationEmails({
            reservation,
            customerEmailIdempotencyKey: idempotencyKey,
          });
        }).pipe(
          Effect.provide(
            WorkspaceReservationEmailService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(EmailServiceTag, emailService),
                  Layer.succeed(EmailConfigTag, emailConfig),
                  WorkspaceCheckoutNetworkDetailsService.Default
                )
              )
            )
          ),
          Effect.runPromise
        );

      Date.now = () =>
        Temporal.Instant.from("2026-06-20T08:00:00Z").epochMilliseconds;
      await sendOnce();
      Date.now = () =>
        Temporal.Instant.from("2026-06-20T09:37:12Z").epochMilliseconds;
      await sendOnce();
    } finally {
      Date.now = originalDateNow;
      Object.assign(env, {
        VERCEL_AUTOMATION_BYPASS_SECRET: previousPreviewBypassSecret,
      });
    }

    expect(sentMessages).toHaveLength(4);
    const [firstCustomer, firstInternal, secondCustomer, secondInternal] =
      sentMessages;
    expect(firstCustomer?.idempotencyKey).toBe(idempotencyKey);
    expect(secondCustomer?.idempotencyKey).toBe(idempotencyKey);
    expect(firstCustomer?.html).toContain("accessToken=");
    expect(firstCustomer?.text).toContain("accessToken=");
    expect(secondCustomer).toEqual(firstCustomer);
    expect(secondInternal).toEqual(firstInternal);
    const firstQr = firstCustomer?.attachments?.find(
      (attachment) => attachment.filename === "workspace-wifi-qr.png"
    );
    const secondQr = secondCustomer?.attachments?.find(
      (attachment) => attachment.filename === "workspace-wifi-qr.png"
    );
    expect(
      Buffer.compare(firstQr?.content as Buffer, secondQr?.content as Buffer)
    ).toBe(0);
    expect(
      firstCustomer?.attachments?.map((attachment) => attachment.filename)
    ).toEqual(["workspace-wifi-qr.png"]);
    expect(firstCustomer?.html).toContain(
      "https://workspace.deskohub.cz/workspace-location-map.jpeg"
    );
    expect(staticMapImageCalls).toHaveLength(0);
  });
});
