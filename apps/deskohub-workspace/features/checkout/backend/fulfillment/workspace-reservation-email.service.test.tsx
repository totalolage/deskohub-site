import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type {
  Customer,
  Reservation as DotyposReservation,
  Table as DotyposTable,
} from "@deskohub/dotypos/generated";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
  type EmailSendResult,
} from "@deskohub/email";
import type { EmailService } from "@deskohub/email/backend/service";
import { testEmailAddress } from "@deskohub/test-email";
import { getQueriesForElement } from "@testing-library/react";
import { Context, Effect, Layer, Logger } from "effect";
import type { ReservationAuthor } from "@/features/account/backend/reservation-author-directory.service";
import { SeatingMapFeatureFlagServiceMock } from "@/features/feature-flags/backend/seating-map-feature-flag.service.mock";
import { type Locale, m } from "@/features/i18n";
import {
  type WorkspaceReservation,
  WorkspaceReservationRepository,
} from "@/features/reservation/backend/workspace-reservation.repository";
import {
  type WorkspaceReservationDetails,
  WorkspaceReservationService,
} from "@/features/reservation/backend/workspace-reservation.service";
import { workspaceDefaultFromAddress } from "@/shared/backend/config/email.config";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";

const customerAddress = testEmailAddress("customer");

mock.module("server-only", () => ({}));

/**
 * The test double for the account-owned customer email locale resolver: each
 * send resolves one locale outcome for the reservation's Dotypos customer.
 */
type TestCustomerEmailLocale =
  | { readonly kind: "guest" }
  | { readonly kind: "account"; readonly locale: Locale };

let customerEmailLocaleOutcome:
  | TestCustomerEmailLocale
  | { readonly kind: "read-error"; readonly code: string } = { kind: "guest" };
const customerEmailLocaleReads: string[] = [];

const TestCustomerEmailLocaleService = Context.Service<
  TestCustomerEmailLocaleService,
  {
    readonly byDotyposCustomer: (
      dotyposCustomerId: string
    ) => Effect.Effect<
      TestCustomerEmailLocale,
      { readonly code: "customer-email-locale.read" }
    >;
  }
>()("@test/CustomerEmailLocaleService");
interface TestCustomerEmailLocaleService {
  readonly _: never;
}
Object.assign(TestCustomerEmailLocaleService, {
  Default: Layer.succeed(TestCustomerEmailLocaleService, {
    byDotyposCustomer: (dotyposCustomerId) => {
      customerEmailLocaleReads.push(dotyposCustomerId);
      const outcome = customerEmailLocaleOutcome;
      return outcome.kind === "read-error"
        ? Effect.fail({ code: outcome.code as "customer-email-locale.read" })
        : Effect.succeed(outcome);
    },
  }),
  Live: Layer.succeed(TestCustomerEmailLocaleService, {
    byDotyposCustomer: () => Effect.succeed({ kind: "guest" }),
  }),
});
const { isCustomerOwnAuthor } = await import(
  "@/features/account/backend/reservation-author-directory.service"
);
mock.module("@/features/account", () => ({
  CustomerEmailLocaleService: TestCustomerEmailLocaleService,
  isCustomerOwnAuthor,
}));

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
  email: customerAddress,
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
  authorAccountId: null,
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

const sendPaidReservationEmail = async (
  reservation: WorkspaceReservationDetails
) => {
  const { EmailConfigTag, EmailServiceTag } = await import(
    "@deskohub/email/backend/service"
  );
  const { WorkspaceCheckoutNetworkDetailsService } = await import(
    "./network-details.service"
  );
  const { WorkspaceReservationEmailService } = await import(
    "./workspace-reservation-email.service"
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
      email: workspaceDefaultFromAddress,
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
        customerEmailLocale: reservation.locale,
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default,
              TestCustomerEmailLocaleService.Default
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

  const customerMessage = sentMessages.find((message) =>
    message.tags?.includes("workspace-paid-reservation-access")
  );
  if (!customerMessage) {
    throw new Error("mock customer reservation email was not sent");
  }

  return customerMessage;
};

const renderEmailHtml = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;

  return getQueriesForElement(container);
};

const makeOpenSpaceSnapshotTable = (
  name: string,
  index: number
): DotyposTable => ({
  _cloudId: "synthetic-cloud-id",
  id: `synthetic-table-${index}`,
  name,
  display: true,
  enabled: true,
  locationName: "Main room",
  seats: "2",
  tags: ["cowork:open-space"],
});

const loadOpenSpaceReservationFromSyntheticSnapshot = async () => {
  const providerReads: string[] = [];
  const names = ["9", "10", "11", "12", "15", "16", "wallee", "gromice"];
  const tables = names.map(makeOpenSpaceSnapshotTable);
  const dotyposReservation: DotyposReservation = {
    _branchId: "synthetic-branch-id",
    _cloudId: "synthetic-cloud-id",
    _customerId: "customer-id",
    _tableId: "assigned-only-sentinel-raw-table-id",
    startDate: "2026-06-12T07:00:00.000Z",
    endDate: "2026-06-12T11:00:00.000Z",
    seats: "1",
    status: "CONFIRMED",
  };
  const workspaceReservation = {
    id: "reservation-id",
    dotyposCustomerId: "dotypos-customer-id",
    dotyposReservationId: "dotypos-reservation-id",
    reservationState: "confirmed",
    paymentState: "paid",
    reservationDetails: {
      kind: "cowork",
      entryTier: "open-space",
      coffee: false,
    },
    locale: "en-US",
  } as WorkspaceReservation;
  const details = await Effect.gen(function* () {
    const service = yield* WorkspaceReservationService;
    return yield* service.getReservation("reservation-id");
  }).pipe(
    Effect.provide(
      WorkspaceReservationService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            Layer.mock(WorkspaceReservationRepository, {
              findById: mock(() => Effect.succeed(workspaceReservation)),
            }),
            Layer.mock(DotyposService, {
              getReservation: mock(() => {
                providerReads.push("getReservation");
                return Effect.succeed({
                  reservation: dotyposReservation,
                  customer,
                });
              }),
              getTables: mock(() => {
                providerReads.push("getTables");
                return Effect.succeed(tables);
              }),
            }),
            SeatingMapFeatureFlagServiceMock({
              isEnabled: Effect.succeed(false),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

  return { details, providerReads, names };
};

const extractEmailUrls = (body: string) => {
  const hrefs = [...body.matchAll(/\bhref\s*=\s*(['"])(https?:\/\/.*?)\1/gi)]
    .map((match) => match[2])
    .filter((value): value is string => Boolean(value));
  const textUrls = body.match(/https?:\/\/[^\s"'<>]+/gi) ?? [];

  return [
    ...new Set(
      [...hrefs, ...textUrls].map((value) =>
        value
          .replaceAll("&amp;", "&")
          .replaceAll("&quot;", '"')
          .replaceAll("&#39;", "'")
      )
    ),
  ];
};

const extractReservationEmailUrl = (
  message: EmailMessage,
  pathname: string
) => {
  const candidates = extractEmailUrls(
    `${message.text ?? ""}\n${message.html ?? ""}`
  )
    .map((value) => {
      try {
        return new URL(value);
      } catch {
        return undefined;
      }
    })
    .filter((value): value is URL => Boolean(value))
    .filter((value) => value.pathname === pathname);

  if (candidates.length !== 1) {
    throw new Error("customer email must contain one matching reservation URL");
  }

  const [candidate] = candidates;
  if (!candidate) {
    throw new Error("matching reservation URL is missing");
  }

  return candidate;
};

const getHtmlParagraphTexts = (html: string) =>
  [...html.matchAll(/<p\b[^>]*>([^<]*)<\/p>/g)].map((match) => match[1]);

const getTextValueAfterLabel = (text: string, label: string) => {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const labelIndex = lines.indexOf(label);

  return labelIndex === -1 ? undefined : lines[labelIndex + 1];
};

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

describe("Open Space customer reservation emails", () => {
  test("renders the eligible table names from loaded reservation details in HTML and text", async () => {
    const { details, names, providerReads } =
      await loadOpenSpaceReservationFromSyntheticSnapshot();
    const message = await sendPaidReservationEmail(details);
    const { createWorkspaceReservationCustomerEmailPreviewHtml } = await import(
      "./workspace-reservation-email.service"
    );
    const previewHtml =
      await createWorkspaceReservationCustomerEmailPreviewHtml({
        accessUrl:
          "https://workspace.deskohub.cz/en-US/reservation/access/preview",
        invoiceUrl:
          "https://workspace.deskohub.cz/en-US/reservation/invoice/preview",
        reservation: details,
      }).pipe(Effect.runPromise);
    const expectedTableNames = "9-12, 15, 16, wallee, gromice";

    expect(details.openSpaceTableNames).toEqual(names);
    expect(details.tableName).toBe("assigned-only-sentinel-raw-table-id");
    expect(providerReads.toSorted()).toEqual(["getReservation", "getTables"]);
    expect(message.html).toContain("Tables");
    expect(message.text).toContain("Tables");
    expect(getHtmlParagraphTexts(message.html)).toContain(expectedTableNames);
    expect(getTextValueAfterLabel(message.text ?? "", "Tables")).toBe(
      expectedTableNames
    );
    expect(message.html).not.toContain("assigned-only-sentinel-raw-table-id");
    expect(message.text).not.toContain("assigned-only-sentinel-raw-table-id");
    expect(previewHtml).toContain("Tables");
    expect(previewHtml).toContain(expectedTableNames);
    expect(previewHtml).not.toContain("assigned-only-sentinel-raw-table-id");
  });

  test("does not fall back to the assigned name or raw ID when no eligible name is loaded", async () => {
    const message = await sendPaidReservationEmail(
      makeReservation({
        reservationDetails: {
          kind: "cowork",
          entryTier: "open-space",
          coffee: false,
        },
        tableName: "assigned-only-sentinel-raw-table-id",
        openSpaceTableNames: [],
      })
    );

    expect(message.html).not.toContain(">Table<");
    expect(message.html).not.toContain("Tables");
    expect(message.text).not.toContain("Table");
    expect(message.text).not.toContain("Tables");
    expect(message.html).not.toContain("assigned-only-sentinel-raw-table-id");
    expect(message.text).not.toContain("assigned-only-sentinel-raw-table-id");
  });

  test("keeps one assigned table label for other products", async () => {
    const assignedProducts = [
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      { kind: "cowork", entryTier: "basic", coffee: false },
      { kind: "cowork", entryTier: "plus", coffee: true },
      {
        kind: "cowork",
        entryTier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      },
      { kind: "meeting-room" },
      { kind: "office" },
    ] satisfies readonly WorkspaceReservationDetails["reservationDetails"][];

    for (const reservationDetails of assignedProducts) {
      const message = await sendPaidReservationEmail(
        makeReservation({ reservationDetails, tableName: "12" })
      );

      expect(message.html).toContain(">Table<");
      expect(message.text).toContain("Table");
      expect(message.html).toContain(">12<");
      expect(message.text).toContain("12");
      expect(message.html).not.toContain("Tables");
    }
  });
});

describe("workspace reservation email details", () => {
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
        email: workspaceDefaultFromAddress,
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
          customerEmailLocale: "en-US",
        });
        yield* service.sendCancellationEmail({ reservation });
      }).pipe(
        Effect.provide(
          WorkspaceReservationEmailService.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(EmailServiceTag, emailService),
                Layer.succeed(EmailConfigTag, emailConfig),
                WorkspaceCheckoutNetworkDetailsService.Default,
                TestCustomerEmailLocaleService.Default
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

describe("sendPaidReservationEmails internal notification failure", () => {
  test("keeps the customer send and logs when the internal notification fails", async () => {
    const { EmailConfigTag, EmailServiceError, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const {
      createWorkspaceCheckoutWifiQrPayload,
      WorkspaceCheckoutNetworkDetailsService,
      workspaceCheckoutCustomerNetworkDetails,
    } = await import("./network-details.service");
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const reservation = makeReservation({
      customer: { ...customer, phone: "123456789" },
      tableName: "12",
      tableMap: {
        assignedTableId: "desk-12",
        roomName: "Main room",
        tables: [
          {
            _cloudId: "cloud-id",
            id: "desk-12",
            name: "12",
            locationName: "Main room",
            positionX: "40",
            positionY: "80",
            type: "SQUARE",
          },
        ],
      },
    });
    const sentMessages: EmailMessage[] = [];
    const send = mock((message: EmailMessage) => {
      sentMessages.push(message);

      return sentMessages.length === 1
        ? Effect.succeed(sentResult("customer-email-id"))
        : Effect.fail(new EmailServiceError("Internal notification failed."));
    });
    const emailService: EmailService = {
      send,
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };
    const errorMessages: string[] = [];
    const logger = Logger.make((options) => {
      if (options.logLevel === "Error") {
        errorMessages.push(
          String(
            Array.isArray(options.message)
              ? options.message[0]
              : options.message
          )
        );
      }
    });

    const customerDeliveryId = await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      return yield* service.sendPaidReservationEmails({
        reservation,
        customerEmailLocale: reservation.locale,
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default,
              TestCustomerEmailLocaleService.Default
            )
          )
        )
      ),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    expect(customerDeliveryId).toBe(
      EmailDeliveryIdSchema.make("customer-email-id")
    );
    expect(send).toHaveBeenCalledTimes(2);
    expect(errorMessages).toContain(
      "Workspace reservation internal email failed"
    );
    const [customerEmail, internalEmail] = sentMessages;
    if (!customerEmail || !internalEmail) {
      throw new Error("customer and internal emails were not both sent");
    }
    expect(customerEmail.tags).toEqual(["workspace-paid-reservation-access"]);
    expect(internalEmail.tags).toEqual(["workspace-paid-reservation-internal"]);
    expect(customerEmail.metadata).toMatchObject({
      deploymentEnvironment: "development",
      source: "workspace-paid-fulfillment",
      workspaceReservationId: "reservation-id",
      dotyposReservationId: "dotypos-reservation-id",
      dotyposCustomerId: "dotypos-customer-id",
      dotyposReservationStartDate: "2026-06-12T07:00:00Z",
      dotyposReservationEndDate: "2026-06-12T11:00:00Z",
    });

    const customerHtml = customerEmail.html ?? "";
    const customerText = customerEmail.text ?? "";
    expect(customerEmail.to).toEqual({ email: customerAddress });
    expect(Object.hasOwn(customerEmail.metadata ?? {}, "customerEmail")).toBe(
      false
    );
    for (const pii of ["Ada", "Lovelace", customerAddress, "123456789"]) {
      expect(customerHtml).not.toContain(pii);
      expect(customerText).not.toContain(pii);
    }

    registerWorkspaceComponentTestEnv();
    try {
      const emailView = renderEmailHtml(customerHtml);
      const locale = "en-US";
      const customerAccessHeadingDate = new Intl.DateTimeFormat(locale, {
        weekday: "long",
        day: "numeric",
        month: "long",
        timeZone: "Europe/Prague",
      }).format(new Date("2026-06-12T07:00:00.000Z"));
      const customerAccessHeading = m.checkoutEmailCustomerAccessHeading(
        { date: customerAccessHeadingDate },
        { locale }
      );
      const accessLink = emailView.getByRole("link", {
        name: m.checkoutEmailCustomerAccessButton({}, { locale }),
      });
      const invoiceLink = emailView.getByRole("link", {
        name: m.checkoutEmailCustomerInvoiceDownload({}, { locale }),
      });
      const accessCodeTable = accessLink.closest("table");
      const tableLabel = emailView.getByText(
        m.checkoutEmailTableNumberLabel({}, { locale })
      );
      const networkQrImage = emailView.getByRole("img", {
        name: m.checkoutEmailNetworkHeading({}, { locale }),
      });
      const mapLink = emailView.getByRole("link", {
        name: m.checkoutEmailLocationMapLink({}, { locale }),
      });
      const addressLink = emailView.getByRole("link", {
        name: `${workspaceSiteConstants.location.address.street}, ${workspaceSiteConstants.location.address.postalCode} ${workspaceSiteConstants.location.address.city} - ${workspaceSiteConstants.location.address.cityDistrict}`,
      });
      const expectedMapUrl = `https://www.google.com/maps/dir/?api=1&destination=${workspaceSiteConstants.location.coordinates.lat},${workspaceSiteConstants.location.coordinates.lng}`;

      expect(emailView.getByRole("heading", { level: 1 }).textContent).toBe(
        customerAccessHeading
      );
      expect(customerText).toContain(customerAccessHeading.toUpperCase());
      expect(
        emailView.queryByText(m.reservationEmailNameLabel({}, { locale }))
      ).toBeNull();
      expect(
        emailView.queryByText(m.reservationEmailPhoneLabel({}, { locale }))
      ).toBeNull();
      const fallbackBackground = accessCodeTable?.getAttribute("bgcolor");
      expect(fallbackBackground).toBeTruthy();
      expect(accessCodeTable?.getAttribute("style")).toContain(
        `background-color:${fallbackBackground}`
      );
      expect(accessCodeTable?.contains(invoiceLink)).toBe(false);
      expect(invoiceLink.closest("tr")?.textContent).toContain(
        m.checkoutEmailCustomerInvoiceLabel({}, { locale })
      );
      expect(
        emailView.getByText(m.checkoutEmailNetworkHeading({}, { locale }))
      ).toBeTruthy();
      expect(
        emailView.getByText(workspaceCheckoutCustomerNetworkDetails.ssid)
      ).toBeTruthy();
      expect(
        emailView.getByText(workspaceCheckoutCustomerNetworkDetails.password)
      ).toBeTruthy();
      expect(networkQrImage.getAttribute("src")).toBe("cid:workspace-wifi-qr");
      expect(tableLabel.nextElementSibling?.textContent).toBe("12");
      expect(
        emailView.queryByRole("img", {
          name: m.checkoutStatusTableMapTitle({}, { locale }),
        })
      ).toBeNull();
      expect(customerText).not.toContain(
        m.checkoutStatusTableMapTitle({}, { locale })
      );
      expect(emailView.getByText("dotypos-reservation-id")).toBeTruthy();
      expect(emailView.getByText("reservation-id")).toBeTruthy();
      expect(addressLink.getAttribute("href")).toBe(expectedMapUrl);
      expect(mapLink.getAttribute("href")).toBe(expectedMapUrl);
    } finally {
      await unregisterWorkspaceComponentTestEnv();
    }

    expect(customerEmail.attachments).toHaveLength(1);
    expect(customerEmail.attachments?.[0]).toMatchObject({
      contentId: "workspace-wifi-qr",
      contentType: "image/png",
      filename: "workspace-wifi-qr.png",
    });
    const qrAttachmentContent = customerEmail.attachments?.[0]?.content;
    if (!Buffer.isBuffer(qrAttachmentContent)) {
      throw new Error("Wi-Fi QR attachment content was not a PNG buffer.");
    }
    expect(qrAttachmentContent.subarray(1, 4).toString("ascii")).toBe("PNG");
    expect(
      createWorkspaceCheckoutWifiQrPayload(
        workspaceCheckoutCustomerNetworkDetails
      )
    ).toBe("WIFI:T:WPA;S:Deskohub Workspace;P:Workspace42;;");

    const internalLocale = "cs-CZ";
    const internalHtml = internalEmail.html ?? "";
    const internalText = internalEmail.text ?? "";
    expect(internalEmail.to).toEqual({
      email: testEmailAddress("workspace-internal"),
      name: workspaceSiteConstants.brand.name,
    });
    expect(internalEmail.subject).toBe(
      `[TESTING] ${m.checkoutEmailInternalPaidReservationSubject(
        { orderId: "reservation-id" },
        { locale: internalLocale }
      )}`
    );
    const internalHeading = m.checkoutEmailInternalPaidReservationHeading(
      {},
      { locale: internalLocale }
    );
    expect(internalHtml).toContain(internalHeading);
    expect(internalText).toContain(internalHeading.toUpperCase());
    expect(internalHtml).toContain(customerAddress);
    expect(internalText).toContain(customerAddress);
    for (const accessFragment of ["/reservation/access/", "accessToken="]) {
      expect(internalHtml).not.toContain(accessFragment);
      expect(internalText).not.toContain(accessFragment);
    }
  });
});

describe("sendPaidReservationEmails author confirmation", () => {
  const authorAddress = testEmailAddress("author");
  const authorConfirmationTag = "workspace-reservation-author-confirmation";
  const activeAuthor = (
    overrides: Partial<Extract<ReservationAuthor, { kind: "active" }>> = {}
  ): ReservationAuthor => ({
    kind: "active",
    accountId: "author-account-id",
    dotyposCustomerId: "author-dotypos-customer-id",
    email: authorAddress,
    locale: "cs-CZ",
    ...overrides,
  });

  const sendWithAuthor = async (input: {
    readonly author: ReservationAuthor | null;
    readonly reservation?: WorkspaceReservationDetails;
    readonly failAuthorSend?: boolean;
  }) => {
    const { EmailConfigTag, EmailServiceError, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const reservation = input.reservation ?? makeReservation({});
    const sentMessages: EmailMessage[] = [];
    const emailService: EmailService = {
      send: mock((message: EmailMessage) => {
        sentMessages.push(message);
        return input.failAuthorSend &&
          message.tags?.includes(authorConfirmationTag)
          ? Effect.fail(new EmailServiceError("Author send failed."))
          : Effect.succeed(sentResult(`email-${sentMessages.length}`));
      }),
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };
    const errorMessages: string[] = [];
    const logger = Logger.make((options) => {
      if (options.logLevel === "Error") {
        errorMessages.push(
          String(
            Array.isArray(options.message)
              ? options.message[0]
              : options.message
          )
        );
      }
    });

    const customerDeliveryId = await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      return yield* service.sendPaidReservationEmails({
        reservation,
        customerEmailLocale: "en-US",
        author: input.author,
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default,
              TestCustomerEmailLocaleService.Default
            )
          )
        )
      ),
      Effect.provide(Logger.layer([logger])),
      Effect.runPromise
    );

    return {
      customerDeliveryId,
      errorMessages,
      tags: sentMessages.map((message) => message.tags),
      authorMessage: sentMessages.find((message) =>
        message.tags?.includes(authorConfirmationTag)
      ),
    };
  };

  test("sends only the customer and staff emails for the customer's own booking", async () => {
    const sent = await sendWithAuthor({
      author: activeAuthor({ dotyposCustomerId: "dotypos-customer-id" }),
    });

    expect(sent.tags).toEqual([
      ["workspace-paid-reservation-access"],
      ["workspace-paid-reservation-internal"],
    ]);
  });

  test("sends no author confirmation for a deleted author or an authorless reservation", async () => {
    for (const author of [
      { kind: "deleted", accountId: "author-account-id" } as const,
      null,
    ]) {
      const sent = await sendWithAuthor({ author });

      expect(sent.authorMessage).toBeUndefined();
      expect(sent.tags).toHaveLength(2);
    }
  });

  test("confirms a booking for someone else to the author's login email in the author's language, linking only the status page", async () => {
    const sent = await sendWithAuthor({ author: activeAuthor() });
    const message = sent.authorMessage;
    if (!message) throw new Error("author confirmation was not sent");

    expect(sent.tags).toEqual([
      ["workspace-paid-reservation-access"],
      [authorConfirmationTag],
      ["workspace-paid-reservation-internal"],
    ]);
    expect(message.to).toEqual({ email: authorAddress });
    expect(message.subject).toBe(
      m.checkoutEmailAuthorSubject(
        { customer: "Ada Lovelace" },
        { locale: "cs-CZ" }
      )
    );
    expect(message.idempotencyKey).toBe(
      "workspace-reservation-author-confirmation-reservation-id"
    );
    expect(message.metadata).toEqual({
      deploymentEnvironment: "development",
      source: "workspace-paid-fulfillment",
      workspaceReservationId: "reservation-id",
    });

    const html = message.html ?? "";
    const text = message.text ?? "";
    for (const content of [html, text]) {
      expect(content).not.toContain("accessToken");
      expect(content).not.toContain("/reservation/access/");
      expect(content).not.toContain("/reservation/invoice/");
    }

    registerWorkspaceComponentTestEnv();
    try {
      const emailView = renderEmailHtml(html);
      expect(
        emailView.getByText(
          m.checkoutEmailAuthorHeading(
            {
              customer: "Ada Lovelace",
              product: m.reservationTierBasicTitle({}, { locale: "cs-CZ" }),
            },
            { locale: "cs-CZ" }
          )
        )
      ).toBeDefined();
      const statusLink = emailView.getByRole("link", {
        name: m.checkoutEmailAuthorStatusButton({}, { locale: "cs-CZ" }),
      });
      const statusUrl = new URL(statusLink.getAttribute("href") ?? "");
      expect(statusUrl.pathname).toBe(
        "/cs-CZ/reservation/status/reservation-id"
      );
      expect(statusUrl.searchParams.has("accessToken")).toBe(false);
      for (const link of emailView.getAllByRole("link")) {
        const href = link.getAttribute("href") ?? "";
        expect(href).not.toContain("/reservation/access/");
        expect(href).not.toContain("/reservation/invoice/");
      }
    } finally {
      await unregisterWorkspaceComponentTestEnv();
    }
  });

  test("falls back to the reservation language and a neutral customer name", async () => {
    const sent = await sendWithAuthor({
      author: activeAuthor({ locale: null }),
      reservation: makeReservation({
        customer: { ...customer, firstName: null, lastName: null },
      }),
    });
    const message = sent.authorMessage;
    if (!message) throw new Error("author confirmation was not sent");

    const someoneElse = m.checkoutEmailAuthorCustomerFallback(
      {},
      { locale: "en-US" }
    );
    expect(message.subject).toBe(
      m.checkoutEmailAuthorSubject(
        { customer: someoneElse },
        { locale: "en-US" }
      )
    );
    expect(message.html).toContain(
      m.checkoutEmailAuthorHeading(
        {
          customer: someoneElse,
          product: m.reservationTierBasicTitle({}, { locale: "en-US" }),
        },
        { locale: "en-US" }
      )
    );
    expect(message.text).toContain("/en-US/reservation/status/reservation-id");
  });

  test("renders the author confirmation preview in each shipped locale", async () => {
    const { createReservationAuthorEmailPreviewHtml } = await import(
      "./workspace-reservation-email.service"
    );

    for (const locale of ["en-US", "cs-CZ"] as const) {
      const statusUrl = `https://workspace.deskohub.test/${locale}/reservation/status/reservation-id`;
      const html = await createReservationAuthorEmailPreviewHtml({
        statusUrl,
        reservation: makeReservation({ locale }),
      }).pipe(Effect.runPromise);

      expect(html).toContain(`lang="${locale}"`);
      expect(html).toContain(
        m.checkoutEmailAuthorHeading(
          {
            customer: "Ada Lovelace",
            product: m.reservationTierBasicTitle({}, { locale }),
          },
          { locale }
        )
      );
      expect(html).toContain(`href="${statusUrl}"`);
      expect(html).toContain(m.checkoutEmailAuthorStatusButton({}, { locale }));
    }
  });

  test("keeps the customer delivery and logs when the author confirmation fails", async () => {
    const sent = await sendWithAuthor({
      author: activeAuthor(),
      failAuthorSend: true,
    });

    expect(sent.customerDeliveryId).toBe(EmailDeliveryIdSchema.make("email-1"));
    expect(sent.errorMessages).toContain(
      "Workspace reservation author confirmation failed"
    );
    expect(sent.tags).toContainEqual(["workspace-paid-reservation-internal"]);
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
        email: workspaceDefaultFromAddress,
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
          customerEmailLocale: "en-US",
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
                WorkspaceCheckoutNetworkDetailsService.Default,
                TestCustomerEmailLocaleService.Default
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
    const { details: reservation } =
      await loadOpenSpaceReservationFromSyntheticSnapshot();
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
        email: workspaceDefaultFromAddress,
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
            customerEmailLocale: "en-US",
            customerEmailIdempotencyKey: idempotencyKey,
          });
        }).pipe(
          Effect.provide(
            WorkspaceReservationEmailService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(EmailServiceTag, emailService),
                  Layer.succeed(EmailConfigTag, emailConfig),
                  WorkspaceCheckoutNetworkDetailsService.Default,
                  TestCustomerEmailLocaleService.Default
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
    expect(firstCustomer?.html).toContain("9-12, 15, 16, wallee, gromice");
    expect(firstCustomer?.text).toContain("9-12, 15, 16, wallee, gromice");
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

describe("sendPaidReservationEmails reservation access capability", () => {
  test("issues the invoice link in the reservation locale when the email follows a different preference", async () => {
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const { openReservationAccessToken: openSignedReservationAccessToken } =
      await import("@/features/reservation/backend/reservation-access-token");
    const { reservationAccessTokenQueryParam, reservationAccessTokenSchema } =
      await import("@/features/reservation/reservation-access-token");
    const { workspaceReservationIdSchema } = await import(
      "@/features/reservation/persistence-contracts"
    );

    // An English reservation whose owner later saved Czech as their language.
    const reservation = makeReservation({
      id: workspaceReservationIdSchema.make("preference-email-1"),
      locale: "en-US",
    });
    const sentMessages: EmailMessage[] = [];
    const emailService: EmailService = {
      send: mock((message: EmailMessage) => {
        sentMessages.push(message);
        return Effect.succeed(sentResult("preference-email-1"));
      }),
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };

    await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      yield* service.sendPaidReservationEmails({
        reservation,
        customerEmailLocale: "cs-CZ",
      });
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default,
              TestCustomerEmailLocaleService.Default
            )
          )
        )
      ),
      Effect.runPromise
    );

    const customerMessage = sentMessages.find((message) =>
      message.tags?.includes("workspace-paid-reservation-access")
    );
    if (!customerMessage) {
      throw new Error("captured customer reservation email is missing");
    }
    expect(customerMessage.subject).toBe(
      m.checkoutEmailCustomerAccessSubject({}, { locale: "cs-CZ" })
    );

    // The invoice page validates its token and the reservation's locale
    // against the URL locale, so the link is issued in the reservation's.
    const invoiceUrl = extractReservationEmailUrl(
      customerMessage,
      `/en-US/reservation/invoice/${reservation.id}`
    );
    const invoiceToken = invoiceUrl.searchParams.get(
      reservationAccessTokenQueryParam
    );
    if (invoiceToken === null) {
      throw new Error("captured invoice token is missing");
    }
    const invoiceClaims = await Effect.runPromise(
      openSignedReservationAccessToken({
        token: reservationAccessTokenSchema.make(invoiceToken),
        orderId: reservation.id,
        locale: reservation.locale,
      })
    );
    expect(invoiceClaims.locale).toBe("en-US");

    // The access link only needs its token and URL to agree; it follows the
    // email language and the proxy exchanges it before any locale decision.
    const accessUrl = extractReservationEmailUrl(
      customerMessage,
      `/cs-CZ/reservation/access/${reservation.id}`
    );
    const accessToken = accessUrl.searchParams.get(
      reservationAccessTokenQueryParam
    );
    if (accessToken === null) {
      throw new Error("captured access token is missing");
    }
    const accessClaims = await Effect.runPromise(
      openSignedReservationAccessToken({
        token: reservationAccessTokenSchema.make(accessToken),
        orderId: reservation.id,
        locale: "cs-CZ",
      })
    );
    expect(accessClaims.locale).toBe("cs-CZ");
  });

  test("captures real signed access and invoice links for both locales and exchanges the access link", async () => {
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { NextRequest } = await import("next/server");
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
    );
    const { proxy } = await import("@/proxy");
    const { getReservationAccessCookieName } = await import(
      "@/features/reservation/backend/reservation-access-cookie"
    );
    const { openReservationAccessToken: openSignedReservationAccessToken } =
      await import("@/features/reservation/backend/reservation-access-token");
    const { reservationAccessTokenQueryParam, reservationAccessTokenSchema } =
      await import("@/features/reservation/reservation-access-token");
    const { workspaceReservationIdSchema } = await import(
      "@/features/reservation/persistence-contracts"
    );

    // Keep the service and its token signer real; only the email transport is captured.
    const reservations = (["en-US", "cs-CZ"] as const).map((locale, index) =>
      makeReservation({
        id: workspaceReservationIdSchema.make(`captured-email-${index + 1}`),
        locale,
      })
    );
    const sentMessages: EmailMessage[] = [];
    const emailService: EmailService = {
      send: mock((message: EmailMessage) => {
        sentMessages.push(message);
        return Effect.succeed(
          sentResult(`captured-email-${sentMessages.length}`)
        );
      }),
      sendTemplate: mock(() => Effect.die("sendTemplate is not used")),
      verify: Effect.succeed(true),
    };
    const emailConfig: EmailProviderConfig = {
      provider: "console",
      defaultFrom: {
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };

    await Effect.gen(function* () {
      const service = yield* WorkspaceReservationEmailService;
      for (const reservation of reservations) {
        yield* service.sendPaidReservationEmails({
          reservation,
          customerEmailLocale: reservation.locale,
        });
      }
    }).pipe(
      Effect.provide(
        WorkspaceReservationEmailService.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailServiceTag, emailService),
              Layer.succeed(EmailConfigTag, emailConfig),
              WorkspaceCheckoutNetworkDetailsService.Default,
              TestCustomerEmailLocaleService.Default
            )
          )
        )
      ),
      Effect.runPromise
    );

    const customerMessages = sentMessages.filter((message) =>
      message.tags?.includes("workspace-paid-reservation-access")
    );
    expect(sentMessages.length).toBe(reservations.length * 2);
    expect(customerMessages.length).toBe(reservations.length);

    for (const reservation of reservations) {
      const customerMessage = customerMessages.find(
        (message) => message.metadata?.workspaceReservationId === reservation.id
      );
      if (!customerMessage) {
        throw new Error("captured customer reservation email is missing");
      }

      const accessUrl = extractReservationEmailUrl(
        customerMessage,
        `/${reservation.locale}/reservation/access/${reservation.id}`
      );
      const invoiceUrl = extractReservationEmailUrl(
        customerMessage,
        `/${reservation.locale}/reservation/invoice/${reservation.id}`
      );
      const accessTokenValue = accessUrl.searchParams.get(
        reservationAccessTokenQueryParam
      );
      const invoiceTokenValue = invoiceUrl.searchParams.get(
        reservationAccessTokenQueryParam
      );

      expect(accessUrl.hash === "").toBe(true);
      expect(invoiceUrl.hash === "").toBe(true);
      expect(
        accessUrl.searchParams.getAll(reservationAccessTokenQueryParam).length
      ).toBe(1);
      expect(
        invoiceUrl.searchParams.getAll(reservationAccessTokenQueryParam).length
      ).toBe(1);
      expect(
        accessTokenValue !== null &&
          accessTokenValue.length > 0 &&
          accessTokenValue.split(".").length === 2
      ).toBe(true);
      expect(
        invoiceTokenValue !== null && invoiceTokenValue === accessTokenValue
      ).toBe(true);

      if (accessTokenValue === null) {
        throw new Error("captured reservation access token is missing");
      }
      const accessToken = reservationAccessTokenSchema.make(accessTokenValue);
      const claims = await Effect.runPromise(
        openSignedReservationAccessToken({
          token: accessToken,
          orderId: reservation.id,
          locale: reservation.locale,
        })
      );
      expect({
        orderMatches: claims.orderId === reservation.id,
        localeMatches: claims.locale === reservation.locale,
        purposeMatches: claims.purpose === "reservation-access",
      }).toEqual({
        orderMatches: true,
        localeMatches: true,
        purposeMatches: true,
      });

      const response = await proxy(new NextRequest(accessUrl));
      expect(response.status).toBe(307);

      const location = response.headers.get("location");
      if (!location) {
        throw new Error("reservation access exchange redirect is missing");
      }
      let cleanUrl: URL;
      try {
        cleanUrl = new URL(location);
      } catch {
        throw new Error("reservation access exchange redirect is invalid");
      }
      expect(cleanUrl.origin === accessUrl.origin).toBe(true);
      expect(cleanUrl.pathname === accessUrl.pathname).toBe(true);
      expect(cleanUrl.search === "" && cleanUrl.hash === "").toBe(true);

      const cookieName = getReservationAccessCookieName(reservation.id);
      const setCookie = response.headers.get("set-cookie") ?? "";
      const cookieHeaderStart = setCookie.indexOf(`${cookieName}=`);
      const cookieHeader =
        cookieHeaderStart === -1 ? "" : setCookie.slice(cookieHeaderStart);
      const hasCookieAttribute = (attribute: string) =>
        new RegExp(`;\\s*${attribute}(?:;|,|$)`, "i").test(cookieHeader);
      const maxAge = Number(/Max-Age=(\d+)/i.exec(cookieHeader)?.[1]);
      expect({
        namedCookie: cookieHeaderStart !== -1,
        signedValue: Boolean(response.cookies.get(cookieName)?.value),
        path: hasCookieAttribute("Path=/"),
        secure: hasCookieAttribute("Secure"),
        httpOnly: hasCookieAttribute("HttpOnly"),
        sameSite: hasCookieAttribute("SameSite=Lax"),
        maxAge: Number.isInteger(maxAge) && maxAge > 0 && maxAge <= 86400,
      }).toEqual({
        namedCookie: true,
        signedValue: true,
        path: true,
        secure: true,
        httpOnly: true,
        sameSite: true,
        maxAge: true,
      });
    }
  });
});

describe("reservation customer email language", () => {
  // The paid-fulfillment workflow owns paid-send locale resolution through the
  // exported resolver; the service itself applies the locale it receives.
  const runResolverScenario = async (
    outcome: typeof customerEmailLocaleOutcome,
    reservation: WorkspaceReservationDetails
  ) => {
    customerEmailLocaleOutcome = outcome;
    customerEmailLocaleReads.length = 0;
    const { createCustomerEmailLocaleResolver } = await import(
      "./workspace-reservation-email.service"
    );

    const exit = await Effect.runPromiseExit(
      Effect.gen(function* () {
        const emailLocale = yield* TestCustomerEmailLocaleService;
        return yield* createCustomerEmailLocaleResolver(emailLocale)(
          reservation
        );
      }).pipe(Effect.provide(TestCustomerEmailLocaleService.Default))
    );
    return { exit, reads: customerEmailLocaleReads };
  };

  const runCancellationScenario = async (
    outcome: typeof customerEmailLocaleOutcome,
    reservation: WorkspaceReservationDetails
  ) => {
    customerEmailLocaleOutcome = outcome;
    customerEmailLocaleReads.length = 0;
    const { WorkspaceReservationEmailService } = await import(
      "./workspace-reservation-email.service"
    );
    const { EmailConfigTag, EmailServiceTag } = await import(
      "@deskohub/email/backend/service"
    );
    const { WorkspaceCheckoutNetworkDetailsService } = await import(
      "./network-details.service"
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
        email: workspaceDefaultFromAddress,
        name: "Deskohub Workspace",
      },
    };

    const { env } = await import("@/env");
    const previousPreviewBypassSecret = env.VERCEL_AUTOMATION_BYPASS_SECRET;
    Object.assign(env, {
      VERCEL_AUTOMATION_BYPASS_SECRET: "synthetic-preview-bypass",
    });
    try {
      const exit = await Effect.runPromiseExit(
        Effect.gen(function* () {
          const service = yield* WorkspaceReservationEmailService;
          yield* service.sendCancellationEmail({ reservation });
        }).pipe(
          Effect.provide(
            WorkspaceReservationEmailService.Default.pipe(
              Layer.provide(
                Layer.mergeAll(
                  Layer.succeed(EmailServiceTag, emailService),
                  Layer.succeed(EmailConfigTag, emailConfig),
                  WorkspaceCheckoutNetworkDetailsService.Default,
                  TestCustomerEmailLocaleService.Default
                )
              )
            )
          )
        )
      );
      return { exit, sentMessages, reads: customerEmailLocaleReads };
    } finally {
      Object.assign(env, {
        VERCEL_AUTOMATION_BYPASS_SECRET: previousPreviewBypassSecret,
      });
    }
  };

  test("uses the linked account's saved preference over the reservation locale", async () => {
    const reservation = makeReservation({ locale: "en-US" });

    const { exit, reads } = await runResolverScenario(
      { kind: "account", locale: "cs-CZ" },
      reservation
    );

    expect(exit._tag).toBe("Success");
    expect(exit._tag === "Success" && exit.value).toBe("cs-CZ");
    expect(reads).toEqual([reservation.dotyposCustomerId]);
  });

  test("keeps the reservation locale for an unlinked guest reservation", async () => {
    const reservation = makeReservation({ locale: "en-US" });

    const { exit, reads } = await runResolverScenario(
      { kind: "guest" },
      reservation
    );

    expect(exit._tag).toBe("Success");
    expect(exit._tag === "Success" && exit.value).toBe("en-US");
    expect(reads).toEqual([reservation.dotyposCustomerId]);
  });

  test("fails instead of guessing a language when the preference read fails", async () => {
    const reservation = makeReservation({ locale: "en-US" });

    const { exit, reads } = await runResolverScenario(
      { kind: "read-error", code: "customer-email-locale.read" },
      reservation
    );

    expect(exit._tag).toBe("Failure");
    expect(reads).toEqual([reservation.dotyposCustomerId]);
  });

  test("uses the linked account's saved preference for cancellation emails", async () => {
    const { m } = await import("@/features/i18n");
    const reservation = makeReservation({ locale: "en-US" });

    const { exit, sentMessages, reads } = await runCancellationScenario(
      { kind: "account", locale: "cs-CZ" },
      reservation
    );

    expect(exit._tag).toBe("Success");
    expect(reads).toEqual([reservation.dotyposCustomerId]);
    const cancellationMessage = sentMessages[0];
    expect(cancellationMessage?.subject).toBe(
      m.reservationCancellationEmailSubject({}, { locale: "cs-CZ" })
    );
  });
});
