import type { Customer } from "@deskohub/dotypos/generated";
import type { NetworkError } from "@deskohub/email/backend/network-error";
import {
  EmailConfigTag,
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
import { ReservationNotificationEmail } from "@/emails/reservation-notification";
import type { WorkspaceEmailDetail } from "@/emails/workspace-email-detail";
import { env } from "@/env";
import {
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
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import type { StoredCoworkReservationDetails } from "@/features/reservation/cowork-reservation-product";
import {
  formatReservationDisplayDate,
  formatReservationDisplayDateRange,
} from "@/features/reservation/reservation-date";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import {
  internalWorkspaceEmailRecipient,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapImagePath,
  workspaceSiteConstants,
} from "@/shared/utils";
import { temporalInstantToDate } from "@/shared/utils/temporal";
import {
  createWorkspaceCheckoutWifiQrPayload,
  type WorkspaceCheckoutNetworkDetails,
  WorkspaceCheckoutNetworkDetailsService,
  workspaceCheckoutPlaceholderNetworkDetails,
} from "./network-details.service";
import { createWorkspaceMeetingRoomEmailDetailRows } from "./workspace-meeting-room-email-details";

export interface IWorkspaceReservationEmailService {
  readonly sendPaidReservationEmails: (input: {
    readonly reservation: WorkspaceReservationDetails;
  }) => Effect.Effect<void, EmailServiceError | NetworkError>;
  readonly sendCancellationEmail: (input: {
    readonly reservation: WorkspaceReservationDetails;
  }) => Effect.Effect<void, EmailServiceError | NetworkError>;
}

const workspaceLocationMapContentId = "workspace-location-map";
const workspaceNetworkQrContentId = "workspace-wifi-qr";
const internalTestingSubjectPrefix = "[TESTING]";
const internalNotificationLocale: Locale = "cs-CZ";

const customerAccessHeadingDateFormatOptions = {
  weekday: "long",
  day: "numeric",
  month: "long",
  timeZone: workspaceSiteConstants.location.timeZone,
} satisfies Intl.DateTimeFormatOptions;

const getReservationLocale = (locale: string): Locale =>
  isLocale(locale) ? locale : "cs-CZ";

const getCustomerName = (customer: Customer) =>
  [customer.firstName, customer.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => Boolean(part))
    .join(" ") ||
  customer.companyName?.trim() ||
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

const createInternalReservationSubject = (
  reservation: WorkspaceReservationDetails
) => {
  const subject = m.checkoutEmailInternalPaidReservationSubject(
    { orderId: reservation.id },
    { locale: internalNotificationLocale }
  );

  if (env.VERCEL_ENV === "production") {
    return subject;
  }

  return `${internalTestingSubjectPrefix} ${subject}`;
};

const createWorkspaceLocationMapAttachment = (): Effect.Effect<
  EmailAttachment,
  EmailServiceError
> =>
  generateWorkspaceLocationMapImage().pipe(
    Effect.map((content) => ({
      content,
      contentId: workspaceLocationMapContentId,
      contentType: "image/jpeg",
      filename: workspaceLocationMapImagePath.slice(1),
    })),
    Effect.mapError(
      (cause) =>
        new EmailServiceError(
          "Workspace reservation location map could not be generated.",
          cause
        )
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
        button: m.checkoutEmailCustomerInvoiceButton(
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
      {...(input.reservation.tableName
        ? { table: { name: input.reservation.tableName } }
        : {})}
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
            networkDetails: workspaceCheckoutPlaceholderNetworkDetails,
            networkQrImageSrc: `data:image/png;base64,${networkQrPng.toString("base64")}`,
            locationMapImageSrc: `https://${workspaceSiteConstants.brand.domain}${workspaceLocationMapImagePath}`,
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
          workspaceCheckoutPlaceholderNetworkDetails
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
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const emailService = yield* EmailServiceTag;
      const emailConfig = yield* EmailConfigTag;
      const networkDetailsService =
        yield* WorkspaceCheckoutNetworkDetailsService;

      const createCustomerAccessUrls = Effect.fn(
        "WorkspaceReservationEmailService.createCustomerAccessUrls"
      )(function* (reservation: WorkspaceReservationDetails, locale: Locale) {
        const accessToken = yield* createReservationAccessToken({
          orderId: reservation.id,
          locale,
        });
        const origin = yield* getWorkspaceRuntimeCallbackOrigin;

        const pathInput = {
          locale,
          orderId: reservation.id,
          accessToken,
          setBypassCookie: true,
        };
        return {
          accessUrl: new URL(
            getReservationAccessPath(pathInput),
            origin
          ).toString(),
          invoiceUrl: new URL(
            getReservationInvoicePath(pathInput),
            origin
          ).toString(),
        };
      });

      return {
        sendCancellationEmail: Effect.fn(
          "WorkspaceReservationEmailService.sendCancellationEmail"
        )(function* ({ reservation }) {
          const locale = getReservationLocale(reservation.locale);
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
        )(function* ({ reservation }) {
          const locale = getReservationLocale(reservation.locale);
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

          const locationMapAttachment =
            yield* createWorkspaceLocationMapAttachment().pipe(
              Effect.catch((cause) =>
                Effect.logError(
                  "Workspace reservation location map attachment skipped",
                  {
                    cause,
                    workspaceReservationId: reservation.id,
                  }
                ).pipe(Effect.as(undefined))
              )
            );
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
              locationMapImageSrc: locationMapAttachment
                ? `cid:${locationMapAttachment.contentId}`
                : undefined,
            })
          );
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceEmailRecipient,
            subject: m.checkoutEmailCustomerAccessSubject({}, { locale }),
            html: renderedCustomerEmail.html,
            text: renderedCustomerEmail.text,
            attachments: [locationMapAttachment, networkQrAttachment].filter(
              (attachment): attachment is EmailAttachment => Boolean(attachment)
            ),
            tags: ["workspace-paid-reservation-access"],
            metadata,
          };

          yield* emailService.send(customerMessage).pipe(
            Effect.tapError((cause) =>
              Effect.logError("Workspace reservation customer email failed", {
                cause,
                workspaceReservationId: reservation.id,
              })
            ),
            Effect.asVoid
          );

          yield* Effect.gen(function* () {
            const renderedInternalEmail = yield* renderWorkspaceEmail(
              createInternalReservationEmail(reservation)
            );
            const internalMessage: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: internalWorkspaceEmailRecipient,
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
        }),
      };
    })
  );
}
