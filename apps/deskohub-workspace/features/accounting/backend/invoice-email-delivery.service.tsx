import type { EmailMessage, EmailRecipient } from "@deskohub/email";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Match } from "effect";
import { InvoiceDeliveryEmail } from "@/emails/invoice-delivery";
import { env } from "@/env";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { m } from "@/features/i18n";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import {
  internalWorkspaceEmailRecipient,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { type Invoice, InvoiceRepository } from "./invoice.repository";
import {
  type IInvoiceEmailDeliveryRepository,
  type InvoiceEmailDeliveryClaim,
  InvoiceEmailDeliveryRepository,
} from "./invoice-email-delivery.repository";
import { renderInvoicePdf } from "./invoice-pdf";

const invoiceCustomerEmailCategory = "workspace-invoice-customer";
const invoiceInternalEmailCategory = "workspace-invoice-internal";
const internalTestingSubjectPrefix = "[TESTING]";
const internalInvoiceLocale = "cs-CZ" as const;
const INVOICE_EMAIL_PROCESSING_RETRY_AFTER_MS = 60 * 1000;

export class InvoiceEmailDeliveryError extends Data.TaggedError(
  "InvoiceEmailDeliveryError"
)<{
  readonly code:
    | "delivery_recipient_unavailable"
    | "delivery_in_progress"
    | "email_delivery_failed"
    | "invoice_load_failed"
    | "pdf_render_failed"
    | "persistence_failed";
  readonly paymentAttemptId: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type InvoiceEmailDeliveryResult =
  | { readonly status: "not_issued" }
  | { readonly status: "delivered"; readonly changed: boolean };

export interface IInvoiceEmailDeliveryService {
  readonly deliverByPaymentAttemptId: (input: {
    readonly paymentAttemptId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
  readonly resendCustomerByPaymentAttemptId: (input: {
    readonly paymentAttemptId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
}

export class InvoiceEmailDeliveryService extends Context.Service<
  InvoiceEmailDeliveryService,
  IInvoiceEmailDeliveryService
>()("@deskohub-workspace/accounting/InvoiceEmailDeliveryService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const accountingSnapshots = yield* AccountingDocumentSnapshotRepository;
      const deliveries = yield* InvoiceEmailDeliveryRepository;
      const emailConfig = yield* EmailConfigTag;
      const emailService = yield* EmailServiceTag;
      const invoices = yield* InvoiceRepository;

      const deliverAudience = Effect.fn(
        "InvoiceEmailDeliveryService.deliverAudience"
      )(function* (input: {
        readonly invoice: Invoice;
        readonly audience: "customer" | "internal";
        readonly recipient: EmailRecipient;
        readonly pdf: Buffer;
        readonly resend?: boolean;
      }) {
        const messageInput = {
          invoiceNumber: input.invoice.invoiceNumber,
          orderId: input.invoice.workspaceReservationId,
        };
        const content = Match.value(input.audience).pipe(
          Match.when("customer", () => {
            const locale = input.invoice.document.locale;
            return {
              body: m.invoiceEmailBody(messageInput, { locale }),
              category: invoiceCustomerEmailCategory,
              heading: m.invoiceEmailHeading({}, { locale }),
              locale,
              subjectPrefix: "",
            };
          }),
          Match.when("internal", () => {
            const locale = internalInvoiceLocale;
            let subjectPrefix = "";
            if (env.VERCEL_ENV !== "production") {
              subjectPrefix = `${internalTestingSubjectPrefix} `;
            }
            return {
              body: m.invoiceEmailInternalBody(messageInput, { locale }),
              category: invoiceInternalEmailCategory,
              heading: m.invoiceEmailInternalHeading({}, { locale }),
              locale,
              subjectPrefix,
            };
          }),
          Match.exhaustive
        );
        const title = m.invoiceTitle({}, { locale: content.locale });
        const preview = `${title} ${input.invoice.invoiceNumber}`;
        const rendered = yield* renderWorkspaceEmail(
          <InvoiceDeliveryEmail
            body={content.body}
            heading={content.heading}
            locale={content.locale}
            preview={preview}
          />
        ).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "email_delivery_failed",
              paymentAttemptId: input.invoice.paymentAttemptId,
              message: "Invoice delivery email could not be rendered.",
              cause,
            })
          )
        );
        const staleProcessingBefore = Temporal.Now.instant().subtract({
          milliseconds: INVOICE_EMAIL_PROCESSING_RETRY_AFTER_MS,
        });
        const claim = yield* (
          input.resend
            ? deliveries.claimResend({
                invoiceId: input.invoice.id,
                staleProcessingBefore,
              })
            : deliveries.claim({
                invoiceId: input.invoice.id,
                audience: input.audience,
                staleProcessingBefore,
              })
        ).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "persistence_failed",
              paymentAttemptId: input.invoice.paymentAttemptId,
              message: "Invoice email delivery could not be claimed.",
              cause,
            })
          )
        );

        if (!claim) return false;

        const message: EmailMessage = {
          from: emailConfig.defaultFrom,
          to: input.recipient,
          replyTo: workspaceEmailRecipient,
          subject: `${content.subjectPrefix}${preview}`,
          html: rendered.html,
          text: rendered.text,
          ...(input.resend && {
            idempotencyKey: `workspace-invoice-customer-resend-${input.invoice.id}-${claim.attemptNumber}`,
          }),
          attachments: [
            {
              filename: `${input.invoice.invoiceNumber}.pdf`,
              content: input.pdf,
              contentType: "application/pdf",
            },
          ],
          tags: [content.category],
          metadata: {
            deploymentEnvironment: env.VERCEL_ENV,
            source: "workspace-invoice-delivery",
            workspaceReservationId: input.invoice.workspaceReservationId,
            invoiceId: input.invoice.id,
            audience: input.audience,
          },
        };

        const sendResult = yield* emailService.send(message).pipe(
          Effect.catch((cause) =>
            failDelivery({
              deliveries,
              claim,
              invoice: input.invoice,
              audience: input.audience,
              cause,
            })
          )
        );

        if (sendResult.status === "failed") {
          return yield* failDelivery({
            deliveries,
            claim,
            invoice: input.invoice,
            audience: input.audience,
            cause: new EmailServiceError("Email provider rejected delivery."),
          });
        }

        yield* deliveries
          .markAccepted({
            invoiceId: input.invoice.id,
            audience: input.audience,
            attemptNumber: claim.attemptNumber,
            providerDeliveryId: sendResult.id,
            acceptedAt: Temporal.Now.instant(),
          })
          .pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "persistence_failed",
                paymentAttemptId: input.invoice.paymentAttemptId,
                message: "Accepted invoice email delivery was not recorded.",
                cause,
              })
            )
          );

        return true;
      });

      const loadDelivery = Effect.fn(
        "InvoiceEmailDeliveryService.loadDelivery"
      )(function* (paymentAttemptId: string) {
        const invoice = yield* invoices
          .findByPaymentAttemptId(paymentAttemptId)
          .pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "invoice_load_failed",
                paymentAttemptId,
                message: "Issued invoice could not be loaded for delivery.",
                cause,
              })
            )
          );
        if (!invoice) return null;

        const source = yield* accountingSnapshots
          .findByPaymentAttemptId(
            paymentAttemptIdSchema.make(invoice.paymentAttemptId)
          )
          .pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "invoice_load_failed",
                paymentAttemptId,
                message:
                  "Invoice source snapshot could not be loaded for delivery.",
                cause,
              })
            )
          );
        if (!source?.delivery) {
          return yield* deliveryError({
            code: "delivery_recipient_unavailable",
            paymentAttemptId,
            message: "Invoice delivery recipient is unavailable.",
          });
        }

        const pdf = yield* renderInvoicePdf(invoice.document).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "pdf_render_failed",
              paymentAttemptId,
              message: "Invoice PDF could not be rendered for delivery.",
              cause,
            })
          )
        );
        return { invoice, recipient: source.delivery.email, pdf };
      });

      return {
        deliverByPaymentAttemptId: Effect.fn(
          "InvoiceEmailDeliveryService.deliverByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const delivery = yield* loadDelivery(paymentAttemptId);
          if (!delivery) return { status: "not_issued" } as const;
          const customer = yield* deliverAudience({
            invoice: delivery.invoice,
            audience: "customer",
            recipient: { email: delivery.recipient },
            pdf: delivery.pdf,
          }).pipe(settleDelivery);
          const internal = yield* deliverAudience({
            invoice: delivery.invoice,
            audience: "internal",
            recipient: internalWorkspaceEmailRecipient,
            pdf: delivery.pdf,
          }).pipe(settleDelivery);

          if (!customer.success) return yield* customer.error;
          if (!internal.success) return yield* internal.error;

          return {
            status: "delivered",
            changed: customer.value || internal.value,
          } as const;
        }),
        resendCustomerByPaymentAttemptId: Effect.fn(
          "InvoiceEmailDeliveryService.resendCustomerByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const delivery = yield* loadDelivery(paymentAttemptId);
          if (!delivery) return { status: "not_issued" } as const;

          const changed = yield* deliverAudience({
            invoice: delivery.invoice,
            audience: "customer",
            recipient: { email: delivery.recipient },
            pdf: delivery.pdf,
            resend: true,
          });
          if (!changed) {
            return yield* deliveryError({
              code: "delivery_in_progress",
              paymentAttemptId,
              message: "Another invoice email delivery is already in progress.",
            });
          }
          return { status: "delivered", changed } as const;
        }),
      } satisfies IInvoiceEmailDeliveryService;
    })
  );
}

const settleDelivery = <A,>(
  effect: Effect.Effect<A, InvoiceEmailDeliveryError>
) =>
  effect.pipe(
    Effect.map((value) => ({ success: true as const, value })),
    Effect.catch((error) => Effect.succeed({ success: false as const, error }))
  );

const failDelivery = (input: {
  readonly deliveries: IInvoiceEmailDeliveryRepository;
  readonly claim: InvoiceEmailDeliveryClaim;
  readonly invoice: Invoice;
  readonly audience: "customer" | "internal";
  readonly cause: unknown;
}) =>
  input.deliveries
    .markFailed({
      invoiceId: input.invoice.id,
      audience: input.audience,
      attemptNumber: input.claim.attemptNumber,
      failureCode: "email_send_failed",
    })
    .pipe(
      Effect.mapError((cause) =>
        deliveryError({
          code: "persistence_failed",
          paymentAttemptId: input.invoice.paymentAttemptId,
          message: "Failed invoice email delivery was not recorded.",
          cause,
        })
      ),
      Effect.andThen(
        Effect.fail(
          deliveryError({
            code: "email_delivery_failed",
            paymentAttemptId: input.invoice.paymentAttemptId,
            message: "Invoice email delivery failed.",
            cause: input.cause,
          })
        )
      )
    );

const deliveryError = (
  input: Omit<
    ConstructorParameters<typeof InvoiceEmailDeliveryError>[0],
    "cause"
  > & {
    readonly cause?: unknown;
  }
) =>
  new InvoiceEmailDeliveryError(
    input.cause === undefined
      ? input
      : { ...input, cause: censorLogValue(input.cause) }
  );
