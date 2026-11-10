import type { DotyposCustomer } from "@deskohub/dotypos";
import { getCustomerDisplayName } from "@deskohub/dotypos";
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
import { Context, Effect, Layer, Schema } from "effect";
import { env } from "@/env";
import {
  CustomerEmailLocaleService,
  isCustomerOwnAuthor,
  type ReservationAuthor,
} from "@/features/account";
import { isLocale, type Locale } from "@/features/i18n";
import { createReservationAccessToken } from "@/features/reservation/backend/reservation-access-token";
import {
  getReservationAccessPath,
  getReservationInvoicePath,
} from "@/features/reservation/backend/reservation-access-url";
import type { WorkspaceReservationDetails } from "@/features/reservation/backend/workspace-reservation.service";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import {
  type EmailKind,
  emailKindTags,
} from "@/shared/backend/email/email-kind";
import {
  internalWorkspaceEmailRecipientFor,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import { getReservationStatusPath } from "../checkout/reservation-status-url";
import {
  createWorkspaceCheckoutWifiQrPayload,
  type WorkspaceCheckoutNetworkDetails,
  WorkspaceCheckoutNetworkDetailsService,
  workspaceCheckoutCustomerNetworkDetails,
} from "./network-details.service";
import {
  renderCustomerReservationEmail,
  renderReservationAuthorEmail,
  renderReservationCancellationEmail,
  renderReservationNotificationEmail,
} from "./reservation-emails";

export interface IWorkspaceReservationEmailService {
  readonly sendPaidReservationEmails: (input: {
    readonly reservation: WorkspaceReservationDetails;
    readonly customerEmailLocale: Locale;
    /** The confirmation generation's provider key, chosen by fulfillment. */
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

const paidFulfillmentSource = "workspace-paid-fulfillment" as const;

const CustomerAccessEmailMetadata = Schema.Struct({
  source: Schema.Literal(paidFulfillmentSource),
  workspaceReservationId: workspaceReservationIdSchema,
});

/**
 * The customer confirmation. Its delivery reports settle the reservation's
 * fulfillment, and its idempotency keys derive from its category.
 */
export const customerAccessEmailKind: EmailKind<
  typeof CustomerAccessEmailMetadata.Type
> = {
  category: "workspace-paid-reservation-access",
  metadata: Schema.toStandardSchemaV1(CustomerAccessEmailMetadata),
};
const authorConfirmationCategory = "workspace-reservation-author-confirmation";
const workspaceNetworkQrContentId = "workspace-wifi-qr";

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

const getCustomerName = (customer: DotyposCustomer) =>
  getCustomerDisplayName(customer) ||
  customer.email?.trim() ||
  "Workspace customer";

/** The staff notification's facts: the reservation and how to reach its customer. */
const createReservationNotification = (
  reservation: WorkspaceReservationDetails
) => ({
  reservation,
  customer: {
    name: getCustomerName(reservation.customer),
    email: reservation.customer.email?.trim(),
    phone: reservation.customer.phone,
  },
});

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

export const createWorkspaceReservationCustomerEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderCustomerPreview"
)(
  (input: {
    readonly locale: Locale;
    readonly accessUrl: string;
    readonly invoiceUrl: string;
    readonly reservation: WorkspaceReservationDetails;
  }) =>
    createPreviewNetworkQrPng().pipe(
      Effect.flatMap((networkQrPng) =>
        renderCustomerReservationEmail({
          locale: input.locale,
          reservation: input.reservation,
          accessUrl: input.accessUrl,
          invoiceUrl: input.invoiceUrl,
          network: {
            ssid: workspaceCheckoutCustomerNetworkDetails.ssid,
            password: workspaceCheckoutCustomerNetworkDetails.password,
            qrImageSrc: `data:image/png;base64,${networkQrPng.toString("base64")}`,
          },
        })
      ),
      Effect.map(({ html }) => html)
    )
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

export const createReservationAuthorEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderAuthorPreview"
)(
  (input: {
    readonly locale: Locale;
    readonly statusUrl: string;
    readonly reservation: WorkspaceReservationDetails;
  }) => renderReservationAuthorEmail(input).pipe(Effect.map(({ html }) => html))
);

export const createWorkspaceReservationNotificationEmailPreviewHtml = Effect.fn(
  "WorkspaceReservationEmailService.renderNotificationPreview"
)((input: { readonly reservation: WorkspaceReservationDetails }) =>
  renderReservationNotificationEmail(
    createReservationNotification(input.reservation)
  ).pipe(Effect.map(({ html }) => html))
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
        readonly rendered: Effect.Success<
          ReturnType<typeof renderReservationAuthorEmail>
        >;
      }) =>
        emailService.send({
          from: emailConfig.defaultFrom,
          to: { email: input.author.email },
          replyTo: workspaceEmailRecipient,
          subject: input.rendered.subject,
          html: input.rendered.html,
          text: input.rendered.text,
          tags: [authorConfirmationCategory],
          idempotencyKey: createAuthorConfirmationIdempotencyKey(
            input.reservation.id
          ),
          metadata: {
            deploymentEnvironment: env.VERCEL_ENV,
            source: paidFulfillmentSource,
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
            Effect.bind("rendered", ({ locale, reservation, statusUrl }) =>
              renderReservationAuthorEmail({ locale, reservation, statusUrl })
            ),
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
          const rendered = yield* renderReservationCancellationEmail({
            locale,
            reservation,
          });
          const message: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceEmailRecipient,
            subject: rendered.subject,
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
            source: paidFulfillmentSource,
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
          const renderedCustomerEmail = yield* renderCustomerReservationEmail({
            locale,
            reservation,
            accessUrl,
            invoiceUrl,
            network: {
              ssid: networkDetails.ssid,
              password: networkDetails.password,
              qrImageSrc: networkQrAttachment
                ? `cid:${networkQrAttachment.contentId}`
                : undefined,
            },
          });
          const customerMessage: EmailMessage = {
            from: emailConfig.defaultFrom,
            to: { email: customerEmail },
            replyTo: workspaceEmailRecipient,
            subject: renderedCustomerEmail.subject,
            html: renderedCustomerEmail.html,
            text: renderedCustomerEmail.text,
            attachments: [networkQrAttachment].filter(
              (attachment): attachment is EmailAttachment => Boolean(attachment)
            ),
            ...emailKindTags(customerAccessEmailKind, metadata),
            ...(input.customerEmailIdempotencyKey && {
              idempotencyKey: input.customerEmailIdempotencyKey,
            }),
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
            const renderedInternalEmail =
              yield* renderReservationNotificationEmail(
                createReservationNotification(reservation)
              );
            const internalMessage: EmailMessage = {
              from: emailConfig.defaultFrom,
              to: internalWorkspaceEmailRecipientFor(customerEmail),
              replyTo: { email: customerEmail, name: customerName },
              subject: renderedInternalEmail.subject,
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
