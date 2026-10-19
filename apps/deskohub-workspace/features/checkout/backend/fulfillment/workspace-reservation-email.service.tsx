import { createHash } from "node:crypto";
import { getCustomerDisplayName } from "@deskohub/dotypos";
import type { Customer } from "@deskohub/dotypos/generated";
import type { EmailDeliveryId } from "@deskohub/email";
import {
  EmailConfigTag,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import type {
  EmailAttachment,
  EmailMessage,
} from "@deskohub/email/types/email.types";
import { generateQrCodePngBuffer } from "@deskohub/qr-code";
import { Context, Effect, Layer, Match } from "effect";
import { CustomerReservationEmail } from "@/emails/customer-reservation";
import { ReservationAuthorEmail } from "@/emails/reservation-author";
import { ReservationNotificationEmail } from "@/emails/reservation-notification";
import type { WorkspaceEmailDetail } from "@/emails/workspace-email-detail";
import { env } from "@/env";
import {
  CustomerEmailLocaleService,
  isCustomerOwnAuthor,
  type ReservationAuthor,
} from "@/features/account";
import {
  getReservationProductTitle,
  getWorkspaceOfficeProductTitle,
  getWorkspaceProductMonitorTitle,
  getWorkspaceProductTierTitle,
} from "@/features/checkout/product-catalog.i18n";
import { isLocale, type Locale, m } from "@/features/i18n";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import {
  getReservationAccessPath,
  getReservationInvoicePath,
} from "@/features/reservation/backend/reservation-access-url";
import { getCustomerReservationTable } from "@/features/reservation/backend/reservation-table";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
} from "@/features/reservation/reservation-date";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import {
  type RenderedWorkspaceEmail,
  renderWorkspaceEmail,
} from "@/shared/backend/email/render-react-email";
import {
  internalWorkspaceEmailRecipientFor,
  internalWorkspaceEmailSubject,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import {
  getWorkspaceCanonicalUrl,
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapImagePath,
  workspaceSiteConstants,
} from "@/shared/utils";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import { getReservationStatusPath } from "../checkout/reservation-status-url";
import {
  createWorkspaceCheckoutWifiQrPayload,
  type WorkspaceCheckoutNetworkDetails,
  WorkspaceCheckoutNetworkDetailsService,
  workspaceCheckoutCustomerNetworkDetails,
} from "./network-details.service";
import { createWorkspaceMeetingRoomEmailDetailRows } from "./workspace-meeting-room-email-details";

export interface IWorkspaceReservationEmailService {
  readonly sendPaidReservationEmails: (input: {
    readonly reservation: WorkspaceReservationDetails;
    readonly customerEmailLocale: Locale;
    readonly customerEmailIdempotencyKey?: string;
    /**
     * The reservation's author, or null when it has none. An active author
     * who booked for another customer also gets a confirmation of their own.
     */
    readonly author: ReservationAuthor | null;
  }) => Effect.Effect<EmailDeliveryId, EmailSendError>;
  readonly sendCancellationEmail: (input: {
    readonly reservation: WorkspaceReservationDetails;
  }) => Effect.Effect<void, EmailSendError>;
}

const customerAccessCategory = "workspace-paid-reservation-access";
const customerAccessRecoveryKeyPrefix = `${customerAccessCategory}-recovery-`;
const authorConfirmationCategory = "workspace-reservation-author-confirmation";
const workspaceNetworkQrContentId = "workspace-wifi-qr";
// The hosted map route serves the same image with long-lived caching, so every
// generation references stable bytes instead of embedding a fresh OSM fetch.
const workspaceLocationMapUrl = getWorkspaceCanonicalUrl(
  workspaceLocationMapImagePath
);
const internalNotificationLocale: Locale = "cs-CZ";

export const createCustomerEmailInitialIdempotencyKey = (
  reservationId: WorkspaceReservationId
) => `${customerAccessCategory}-${reservationId}`;

export const createCustomerEmailRecoveryIdempotencyKey = (
  priorCustomerEmailDeliveryId: EmailDeliveryId
) =>
  `${customerAccessRecoveryKeyPrefix}${createHash("sha256")
    .update(priorCustomerEmailDeliveryId)
    .digest("hex")}`;

// The author confirmation is sent once per reservation; fulfillment retries
// and customer delivery recovery reuse this key, so the provider collapses
// them into the first send.
const createAuthorConfirmationIdempotencyKey = (
  reservationId: WorkspaceReservationId
) => `${authorConfirmationCategory}-${reservationId}`;

type ActiveReservationAuthor = Extract<ReservationAuthor, { kind: "active" }>;

/**
 * The author who gets a confirmation of their own: an active account that
 * booked for another customer. A deleted author, an authorless reservation,
 * and a customer's own booking get none.
 */
const getConfirmableAuthor = (
  author: ReservationAuthor | null,
  reservation: WorkspaceReservationDetails
): ActiveReservationAuthor | undefined =>
  author?.kind === "active" &&
  !isCustomerOwnAuthor(author, reservation.dotyposCustomerId)
    ? author
    : undefined;

const customerAccessHeadingDateFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: workspaceSiteConstants.location.timeZone,
} satisfies Intl.DateTimeFormatOptions;

const getReservationLocale = (locale: string): Locale =>
  isLocale(locale) ? locale : "cs-CZ";

/**
 * Resolves the customer email language for one reservation: a linked account
 * with a saved language preference uses it, while an unlinked guest or
 * an account without a preference keeps the reservation locale. A preference
 * read failure fails the email send instead of silently guessing a wrong
 * customer preference.
 *
 * Exported for the paid-fulfillment workflow, which must resolve and retain
 * the locale before a generation's first provider send so failed and
 * accepted-but-unrecorded retries keep a locale-stable idempotency key.
 */
export const createCustomerEmailLocaleResolver =
  (emailLocale: CustomerEmailLocaleService["Service"]) =>
  (reservation: WorkspaceReservationDetails) =>
    emailLocale.byDotyposCustomer(reservation.dotyposCustomerId).pipe(
      Effect.flatMap((resolved) =>
        resolved.kind === "account"
          ? Effect.succeed(resolved.locale)
          : Effect.succeed(getReservationLocale(reservation.locale))
      ),
      Effect.mapError(
        (cause) =>
          new EmailServiceError(
            "Workspace reservation customer email language could not be determined.",
            cause
          )
      ),
      Effect.tapError((cause) =>
        Effect.logError(
          "Workspace reservation customer email language read failed",
          { cause, workspaceReservationId: reservation.id }
        )
      )
    );

const getCustomerName = (customer: Customer) =>
  getCustomerDisplayName(customer) ||
  customer.email?.trim() ||
  "Workspace customer";

const formatCustomerAccessHeadingDate = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  new Intl.DateTimeFormat(
    locale,
    customerAccessHeadingDateFormatOptions
  ).format(temporalInstantToDate(reservation.reservedFrom));

const createCustomerAccessHeading = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  m.checkoutEmailCustomerAccessHeading(
    { date: formatCustomerAccessHeadingDate(reservation, locale) },
    { locale }
  );

/** The customer as the author's confirmation names them. */
const getAuthorConfirmationCustomerName = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  getCustomerDisplayName(reservation.customer) ??
  m.checkoutEmailAuthorCustomerFallback({}, { locale });

const createAuthorConfirmationSubject = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
) =>
  m.checkoutEmailAuthorSubject(
    { customer: getAuthorConfirmationCustomerName(reservation, locale) },
    { locale }
  );

const createInternalReservationSubject = (
  reservation: WorkspaceReservationDetails
) =>
  internalWorkspaceEmailSubject(
    m.checkoutEmailInternalPaidReservationSubject(
      { orderId: reservation.id },
      { locale: internalNotificationLocale }
    )
  );

const createWorkspaceNetworkQrAttachment = (
  networkDetails: WorkspaceCheckoutNetworkDetails
): Effect.Effect<EmailAttachment, EmailServiceError> =>
  Effect.tryPromise({
    try: async () => ({
      content: await generateQrCodePngBuffer(
        createWorkspaceCheckoutWifiQrPayload(networkDetails),
        {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 280,
        }
      ),
      contentId: workspaceNetworkQrContentId,
      contentType: "image/png",
      filename: "workspace-wifi-qr.png",
    }),
    catch: (cause) =>
      new EmailServiceError(
        "Workspace reservation Wi-Fi QR code could not be generated.",
        cause
      ),
  });

const createCoworkReservationDetails = (
  reservation: WorkspaceReservationDetails,
  details: StoredCoworkReservationDetails,
  locale: Locale
): WorkspaceEmailDetail[] => [
  {
    label: m.reservationEmailTierLabel({}, { locale }),
    value: getWorkspaceProductTierTitle(details.entryTier, locale),
  },
  {
    label: m.reservationEmailDateLabel({}, { locale }),
    value: formatReservationDisplayDate(reservation.reservedFrom, locale),
  },
  {
    label: m.reservationEmailCoffeeLabel({}, { locale }),
    value: details.coffee
      ? m.checkoutStatusYes({}, { locale })
      : m.checkoutStatusNo({}, { locale }),
  },
  ...Match.value(details).pipe(
    Match.discriminatorsExhaustive("entryTier")({
      "open-space": () => [],
      "reserved-desk": ({ monitorOption }) =>
        monitorOption
          ? [
              {
                label: m.reservationEmailMonitorsLabel({}, { locale }),
                value: getWorkspaceProductMonitorTitle(monitorOption, locale),
              } satisfies WorkspaceEmailDetail,
            ]
          : [],
      basic: () => [],
      plus: () => [],
      profi: ({ monitorOption }) => [
        {
          label: m.reservationEmailMonitorsLabel({}, { locale }),
          value: getWorkspaceProductMonitorTitle(monitorOption, locale),
        } satisfies WorkspaceEmailDetail,
      ],
    })
  ),
];

const createReservationDetails = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
): WorkspaceEmailDetail[] =>
  Match.value(reservation.reservationDetails).pipe(
    Match.discriminatorsExhaustive("kind")({
      cowork: (details) =>
        createCoworkReservationDetails(reservation, details, locale),
      "meeting-room": () =>
        createWorkspaceMeetingRoomEmailDetailRows(reservation, locale, {
          reservationLabel: m.reservationEmailReservationLabel({}, { locale }),
          reservationTitle: m.reservationTierMeetingRoomTitle({}, { locale }),
          dateLabel: m.reservationEmailDateLabel({}, { locale }),
          timeLabel: m.reservationEmailTimeLabel({}, { locale }),
          wholeDay: m.reservationMeetingRoomDurationWholeDay({}, { locale }),
        }),
      office: () => [
        {
          label: m.reservationEmailReservationLabel({}, { locale }),
          value: getWorkspaceOfficeProductTitle(locale),
        },
        {
          label: m.reservationEmailDateLabel({}, { locale }),
          value: formatReservationDisplayDateRange(
            reservation.reservedFrom,
            reservation.reservedUntil,
            locale
          ),
        },
        {
          label: m.reservationEmailSeatsLabel({}, { locale }),
          value: String(reservation.seats),
        },
      ],
    })
  );

const appendReservationReferenceDetails = (
  details: WorkspaceEmailDetail[],
  reservation: WorkspaceReservationDetails,
  locale: Locale
) => {
  if (reservation.dotyposReservationId) {
    details.push({
      label: m.checkoutEmailDotyposReservationIdLabel({}, { locale }),
      value: reservation.dotyposReservationId,
    });
  }

  details.push({
    label: m.checkoutStatusOrderIdLabel({}, { locale }),
    value: reservation.id,
  });
};

export const createReservationRows = (
  reservation: WorkspaceReservationDetails,
  locale: Locale
): WorkspaceEmailDetail[] => {
  const details = createReservationDetails(reservation, locale);

  appendReservationReferenceDetails(details, reservation, locale);

  return details;
};

const createInternalReservationDetails = (
  reservation: WorkspaceReservationDetails,
  customer: Customer,
  locale: Locale
): WorkspaceEmailDetail[] => {
  const customerEmail = customer.email?.trim();
  const details: WorkspaceEmailDetail[] = [
    {
      label: m.reservationEmailNameLabel({}, { locale }),
      value: getCustomerName(customer),
    },
  ];

  if (customerEmail) {
    details.push({
      label: m.reservationEmailEmailLabel({}, { locale }),
      value: customerEmail,
    });
  }

  if (customer.phone?.trim()) {
    details.push({
      label: m.reservationEmailPhoneLabel({}, { locale }),
      value: customer.phone,
    });
  }

  details.push(...createReservationDetails(reservation, locale));
  appendReservationReferenceDetails(details, reservation, locale);

  return details;
};

const createCustomerReservationEmail = (input: {
  readonly reservation: WorkspaceReservationDetails;
  readonly locale: Locale;
  readonly accessUrl: string;
  readonly invoiceUrl: string;
  readonly networkDetails: WorkspaceCheckoutNetworkDetails;
  readonly networkQrImageSrc?: string;
  readonly locationMapImageSrc?: string;
}) => {
  const subject = m.checkoutEmailCustomerAccessSubject(
    {},
    { locale: input.locale }
  );
  const table = getCustomerReservationTable(input.reservation);

  return (
    <CustomerReservationEmail
      access={{
        button: m.checkoutEmailCustomerAccessButton(
          {},
          { locale: input.locale }
        ),
        url: input.accessUrl,
      }}
      invoice={{
        label: m.checkoutEmailCustomerInvoiceLabel(
          {},
          { locale: input.locale }
        ),
        download: m.checkoutEmailCustomerInvoiceDownload(
          {},
          { locale: input.locale }
        ),
        url: input.invoiceUrl,
      }}
      details={createReservationRows(input.reservation, input.locale)}
      followUp={m.reservationEmailCustomerFollowUp(
        { email: workspaceSiteConstants.contact.infoEmail },
        { locale: input.locale }
      )}
      heading={createCustomerAccessHeading(input.reservation, input.locale)}
      labels={{
        location: m.checkoutEmailLocationHeading({}, { locale: input.locale }),
        directions: m.checkoutEmailLocationMapLink(
          {},
          { locale: input.locale }
        ),
        table: m.checkoutEmailTableNumberLabel({}, { locale: input.locale }),
        tables: m.checkoutEmailTablesLabel({}, { locale: input.locale }),
        network: m.checkoutEmailNetworkHeading({}, { locale: input.locale }),
        networkName: m.checkoutEmailNetworkSsidLabel(
          {},
          { locale: input.locale }
        ),
        networkPassword: m.checkoutEmailNetworkPasswordLabel(
          {},
          { locale: input.locale }
        ),
      }}
      locale={input.locale}
      location={{
        address: workspaceFormattedAddress,
        directionsUrl: workspaceGoogleDirectionsUrl,
        mapImageSrc: input.locationMapImageSrc,
      }}
      network={{
        ssid: input.networkDetails.ssid,
        password: input.networkDetails.password,
        qrImageSrc: input.networkQrImageSrc,
      }}
      preview={subject}
      {...(table && { table })}
    />
  );
};

const createReservationAuthorEmail = (input: {
  readonly reservation: WorkspaceReservationDetails;
  readonly locale: Locale;
  readonly statusUrl: string;
  readonly locationMapImageSrc?: string;
}) => {
  const { reservation, locale } = input;
  const table = getCustomerReservationTable(reservation);

  return (
    <ReservationAuthorEmail
      body={m.checkoutEmailAuthorBody({}, { locale })}
      details={createReservationRows(reservation, locale)}
      followUp={m.reservationEmailCustomerFollowUp(
        { email: workspaceSiteConstants.contact.infoEmail },
        { locale }
      )}
      heading={m.checkoutEmailAuthorHeading(
        {
          customer: getAuthorConfirmationCustomerName(reservation, locale),
          product: getReservationProductTitle(
            reservation.reservationDetails,
            locale
          ),
        },
        { locale }
      )}
      labels={{
        location: m.checkoutEmailLocationHeading({}, { locale }),
        directions: m.checkoutEmailLocationMapLink({}, { locale }),
        table: m.checkoutEmailTableNumberLabel({}, { locale }),
        tables: m.checkoutEmailTablesLabel({}, { locale }),
      }}
      locale={locale}
      location={{
        address: workspaceFormattedAddress,
        directionsUrl: workspaceGoogleDirectionsUrl,
        mapImageSrc: input.locationMapImageSrc,
      }}
      preview={createAuthorConfirmationSubject(reservation, locale)}
      status={{
        button: m.checkoutEmailAuthorStatusButton({}, { locale }),
        url: input.statusUrl,
      }}
      {...(table && { table })}
    />
  );
};

const createInternalReservationEmail = (
  reservation: WorkspaceReservationDetails
) => (
  <ReservationNotificationEmail
    body={m.checkoutEmailInternalPaidReservationBody(
      {},
      { locale: internalNotificationLocale }
    )}
    details={createInternalReservationDetails(
      reservation,
      reservation.customer,
      internalNotificationLocale
    )}
    heading={m.checkoutEmailInternalPaidReservationHeading(
      {},
      { locale: internalNotificationLocale }
    )}
    preview={m.checkoutEmailInternalPaidReservationSubject(
      { orderId: reservation.id },
      { locale: internalNotificationLocale }
    )}
  />
);

export const createWorkspaceReservationCustomerEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderCustomerPreview"
)(
  (input: {
    readonly accessUrl: string;
    readonly invoiceUrl: string;
    readonly reservation: WorkspaceReservationDetails;
  }) => {
    const locale = getReservationLocale(input.reservation.locale);

    return createPreviewNetworkQrPng().pipe(
      Effect.flatMap((networkQrPng) =>
        renderWorkspaceEmail(
          createCustomerReservationEmail({
            reservation: input.reservation,
            locale,
            accessUrl: input.accessUrl,
            invoiceUrl: input.invoiceUrl,
            networkDetails: workspaceCheckoutCustomerNetworkDetails,
            networkQrImageSrc: `data:image/png;base64,${networkQrPng.toString("base64")}`,
            locationMapImageSrc: workspaceLocationMapUrl,
          })
        )
      ),
      Effect.map(({ html }) => html)
    );
  }
);

const createPreviewNetworkQrPng = () =>
  Effect.tryPromise({
    try: () =>
      generateQrCodePngBuffer(
        createWorkspaceCheckoutWifiQrPayload(
          workspaceCheckoutCustomerNetworkDetails
        ),
        {
          errorCorrectionLevel: "M",
          margin: 2,
          width: 280,
        }
      ),
    catch: (cause) =>
      new EmailServiceError(
        "Workspace reservation preview Wi-Fi QR code could not be generated.",
        cause
      ),
  });

/**
 * The author's status page link. The author's own session authorizes the
 * page, so the link carries no reservation capability.
 */
const createAuthorStatusUrl = (input: {
  readonly reservation: WorkspaceReservationDetails;
  readonly locale: Locale;
}) =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.map((origin) =>
      new URL(
        getReservationStatusPath({
          locale: input.locale,
          orderId: input.reservation.id,
          setBypassCookie: true,
        }),
        origin
      ).toString()
    )
  );

const renderAuthorConfirmation = (input: {
  readonly reservation: WorkspaceReservationDetails;
  readonly locale: Locale;
  readonly statusUrl: string;
}) =>
  renderWorkspaceEmail(
    createReservationAuthorEmail({
      reservation: input.reservation,
      locale: input.locale,
      statusUrl: input.statusUrl,
      locationMapImageSrc: workspaceLocationMapUrl,
    })
  );

export const createReservationAuthorEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderAuthorPreview"
)(
  (input: {
    readonly statusUrl: string;
    readonly reservation: WorkspaceReservationDetails;
  }) =>
    renderAuthorConfirmation({
      ...input,
      locale: getReservationLocale(input.reservation.locale),
    }).pipe(Effect.map(({ html }) => html))
);

export const createWorkspaceReservationNotificationEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderNotificationPreview"
)((input: { readonly reservation: WorkspaceReservationDetails }) =>
  renderWorkspaceEmail(createInternalReservationEmail(input.reservation)).pipe(
    Effect.map(({ html }) => html)
  )
);

export class WorkspaceReservationEmailService extends Context.Service<
  WorkspaceReservationEmailService,
  IWorkspaceReservationEmailService
>()(
  "@deskohub-workspace/checkout/fulfillment/WorkspaceReservationEmailService"
) {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      const emailConfig = yield* EmailConfigTag;
      const networkDetailsService =
        yield* WorkspaceCheckoutNetworkDetailsService;
      const emailLocaleService = yield* CustomerEmailLocaleService;
      const resolveCustomerEmailLocale =
        createCustomerEmailLocaleResolver(emailLocaleService);

      const createCustomerAccessUrls = Effect.fn(
        "WorkspaceReservationEmailService.createCustomerAccessUrls"
      )(function* (reservation: WorkspaceReservationDetails, locale: Locale) {
        const origin = yield* getWorkspaceRuntimeCallbackOrigin;
        // Idempotent provider retries resend the same key, so each token must
        // be a pure function of the reservation and its locale; anchor
        // issuance at the reservation's immutable start.
        const createLink = Effect.fn(function* (
          linkLocale: Locale,
          getPath: typeof getReservationAccessPath
        ) {
          const accessToken = yield* createReservationAccessToken(
            { orderId: reservation.id, locale: linkLocale },
            { now: () => reservation.reservedFrom.epochMilliseconds }
          );
          return new URL(
            getPath({
              locale: linkLocale,
              orderId: reservation.id,
              accessToken,
              setBypassCookie: true,
            }),
            origin
          ).toString();
        });

        return {
          // The access link only needs its token and URL to agree, and the
          // proxy exchanges it before any locale decision, so it follows the
          // email language.
          accessUrl: yield* createLink(locale, getReservationAccessPath),
          // The invoice page issues the invoice in the reservation's locale
          // and validates it against the URL, so its link keeps that locale
          // even when the email follows the customer's saved preference.
          invoiceUrl: yield* createLink(
            getReservationLocale(reservation.locale),
            getReservationInvoicePath
          ),
        };
      });

      const sendAuthorEmail = (input: {
        readonly reservation: WorkspaceReservationDetails;
        readonly author: ActiveReservationAuthor;
        readonly locale: Locale;
        readonly rendered: RenderedWorkspaceEmail;
      }) =>
        emailService.send({
          from: emailConfig.defaultFrom,
          to: { email: input.author.email },
          replyTo: workspaceEmailRecipient,
          subject: createAuthorConfirmationSubject(
            input.reservation,
            input.locale
          ),
          html: input.rendered.html,
          text: input.rendered.text,
          tags: [authorConfirmationCategory],
          idempotencyKey: createAuthorConfirmationIdempotencyKey(
            input.reservation.id
          ),
          metadata: {
            deploymentEnvironment: env.VERCEL_ENV,
            source: "workspace-paid-fulfillment",
            workspaceReservationId: input.reservation.id,
          },
        });

      const sendAuthorConfirmation = Effect.fn(
        "WorkspaceReservationEmailService.sendAuthorConfirmation"
      )(
        (input: {
          readonly reservation: WorkspaceReservationDetails;
          readonly author: ActiveReservationAuthor;
        }) =>
          Effect.succeed(input).pipe(
            Effect.let(
              "locale",
              ({ reservation, author }) =>
                author.locale ?? getReservationLocale(reservation.locale)
            ),
            Effect.bind("statusUrl", createAuthorStatusUrl),
            Effect.bind("rendered", renderAuthorConfirmation),
            Effect.flatMap(sendAuthorEmail)
          )
      );

      return {
        sendCancellationEmail: Effect.fn(
          "WorkspaceReservationEmailService.sendCancellationEmail"
        )(function* ({ reservation }) {
          const locale = yield* resolveCustomerEmailLocale(reservation);
          const customerEmail = reservation.customer.email?.trim();
          if (!customerEmail) {
            return yield* Effect.fail(
              new EmailServiceError(
                "Workspace reservation customer email is missing."
              )
            );
          }
          const subject = m.reservationCancellationEmailSubject({}, { locale });
          const rendered = yield* renderWorkspaceEmail(
            <ReservationNotificationEmail
              body={m.reservationCancellationEmailBody({}, { locale })}
              details={createReservationRows(reservation, locale)}
              heading={m.reservationCancellationEmailHeading({}, { locale })}
              locale={locale}
              preview={subject}
            />
          );
          const message: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceEmailRecipient,
            subject,
            html: rendered.html,
            text: rendered.text,
            tags: ["workspace-reservation-cancellation"],
            metadata: {
              deploymentEnvironment: env.VERCEL_ENV,
              source: "workspace-reservation-administration",
              workspaceReservationId: reservation.id,
              dotyposReservationId: reservation.dotyposReservationId,
            },
          };
          yield* emailService.send(message).pipe(Effect.asVoid);
        }),
        sendPaidReservationEmails: Effect.fn(
          "WorkspaceReservationEmailService.sendPaidReservationEmails"
        )(function* (input) {
          const { reservation } = input;
          const locale = input.customerEmailLocale;
          const customer = reservation.customer;
          const customerName = getCustomerName(customer);
          const customerEmail = customer.email?.trim();
          const networkDetails =
            yield* networkDetailsService.resolveCustomerNetworkDetails({
              reservation,
            });
          const { accessUrl, invoiceUrl } = yield* createCustomerAccessUrls(
            reservation,
            locale
          ).pipe(
            Effect.mapError(
              (cause) =>
                new EmailServiceError(
                  "Workspace reservation access URL could not be created.",
                  cause
                )
            )
          );
          const metadata = {
            deploymentEnvironment: env.VERCEL_ENV,
            source: "workspace-paid-fulfillment",
            workspaceReservationId: reservation.id,
            dotyposReservationId: reservation.dotyposReservationId,
            dotyposCustomerId: reservation.dotyposCustomerId,
            dotyposReservationStartDate: reservation.reservedFrom.toString(),
            dotyposReservationEndDate: reservation.reservedUntil.toString(),
          };

          if (!customerEmail) {
            yield* Effect.logWarning(
              "Workspace reservation customer email skipped: missing customer email",
              { workspaceReservationId: reservation.id }
            );
            return yield* Effect.fail(
              new EmailServiceError(
                "Workspace reservation customer email is missing."
              )
            );
          }

          const networkQrAttachment = yield* createWorkspaceNetworkQrAttachment(
            networkDetails
          ).pipe(
            Effect.catch((cause) =>
              Effect.logError(
                "Workspace reservation Wi-Fi QR attachment skipped",
                {
                  cause,
                  workspaceReservationId: reservation.id,
                }
              ).pipe(Effect.as(undefined))
            )
          );
          const renderedCustomerEmail = yield* renderWorkspaceEmail(
            createCustomerReservationEmail({
              reservation,
              locale,
              accessUrl,
              invoiceUrl,
              networkDetails,
              networkQrImageSrc: networkQrAttachment
                ? `cid:${networkQrAttachment.contentId}`
                : undefined,
              locationMapImageSrc: workspaceLocationMapUrl,
            })
          );
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceEmailRecipient,
            subject: m.checkoutEmailCustomerAccessSubject({}, { locale }),
            html: renderedCustomerEmail.html,
            text: renderedCustomerEmail.text,
            attachments: [networkQrAttachment].filter(
              (attachment): attachment is EmailAttachment => Boolean(attachment)
            ),
            tags: [customerAccessCategory],
            ...(input.customerEmailIdempotencyKey && {
              idempotencyKey: input.customerEmailIdempotencyKey,
            }),
            metadata,
          };

          const customerSendResult = yield* emailService
            .send(customerMessage)
            .pipe(
              Effect.tapError((cause) =>
                Effect.logError("Workspace reservation customer email failed", {
                  cause,
                  workspaceReservationId: reservation.id,
                })
              )
            );

          const confirmableAuthor = getConfirmableAuthor(
            input.author,
            reservation
          );
          if (confirmableAuthor) {
            // Best effort: the customer confirmation alone decides the
            // fulfillment outcome.
            yield* sendAuthorConfirmation({
              reservation,
              author: confirmableAuthor,
            }).pipe(
              Effect.catchCause(() =>
                Effect.logError(
                  "Workspace reservation author confirmation failed",
                  {
                    code: "fulfillment.author-confirmation.send-failed",
                    workspaceReservationId: reservation.id,
                  }
                )
              )
            );
          }

          yield* Effect.gen(function* () {
            const renderedInternalEmail = yield* renderWorkspaceEmail(
              createInternalReservationEmail(reservation)
            );
            const internalMessage: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: internalWorkspaceEmailRecipientFor(customerEmail),
              replyTo: { email: customerEmail, name: customerName },
              subject: createInternalReservationSubject(reservation),
              html: renderedInternalEmail.html,
              text: renderedInternalEmail.text,
              tags: ["workspace-paid-reservation-internal"],
              metadata,
            };

            yield* emailService.send(internalMessage);
          }).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Workspace reservation internal email failed", {
                cause,
                workspaceReservationId: reservation.id,
              })
            ),
            Effect.ignore
          );

          return customerSendResult.id;
        }),
      };
    })
  );
}
