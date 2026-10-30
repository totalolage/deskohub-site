import type { EmailMessage, EmailRecipient } from "@deskohub/email";
import {
  EmailConfigTag,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email/backend/service";
import { Context, Data, Effect, Layer, Match } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { InvoiceDeliveryEmail } from "@/emails/invoice-delivery";
import { env } from "@/env";
import { isManualInvoiceDocument } from "@/features/accounting/invoice";
import {
  getInvoiceSettlement,
  InvoiceSettlement,
} from "@/features/accounting/invoice-settlement";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { m } from "@/features/i18n";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { renderWorkspaceEmail } from "@/shared/backend/email/render-react-email";
import {
  internalWorkspaceEmailRecipientFor,
  internalWorkspaceEmailSubject,
  workspaceEmailRecipient,
} from "@/shared/backend/email/workspace-email-recipients";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import { AccountingDocumentSnapshotRepository } from "./accounting-document-snapshot.repository";
import { AccountingSnapshotKeyService } from "./accounting-snapshot-key.service";
import { type Invoice, InvoiceRepository } from "./invoice.repository";
import {
  type IInvoiceEmailDeliveryRepository,
  type InvoiceEmailDeliveryClaim,
  InvoiceEmailDeliveryRepository,
} from "./invoice-email-delivery.repository";
import { type InvoicePdfRenderingError, renderInvoicePdf } from "./invoice-pdf";

const invoiceCustomerEmailCategory = "workspace-invoice-customer";
const invoiceInternalEmailCategory = "workspace-invoice-internal";
const internalInvoiceLocale = "cs-CZ" as const;

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
  readonly customerDelivered?: boolean;
  readonly cause?: unknown;
}> {}

export type InvoiceEmailDeliveryResult =
  | { readonly status: "not_issued" }
  | { readonly status: "delivered"; readonly changed: boolean };

export interface IInvoiceEmailDeliveryService {
  readonly deliverByInvoiceId: (input: {
    readonly invoiceId: string;
  }) => Effect.Effect<InvoiceEmailDeliveryResult, InvoiceEmailDeliveryError>;
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
  static Default = Layer.effect(
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
        readonly renderPdf: Effect.Effect<Buffer, InvoicePdfRenderingError>;
        readonly resend?: boolean;
      }) {
        const claim = yield* (
          input.resend
            ? deliveries.claimResend({ invoiceId: input.invoice.id })
            : deliveries.claim({
                invoiceId: input.invoice.id,
                audience: input.audience,
              })
        ).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "persistence_failed",
              paymentAttemptId:
                input.invoice.paymentAttemptId ?? input.invoice.id,
              message: "Invoice email delivery could not be claimed.",
              cause,
            })
          )
        );

        if (!claim) return false;

        const manualDocument = isManualInvoiceDocument(input.invoice.document)
          ? input.invoice.document
          : null;
        const content = Match.value(input.audience).pipe(
          Match.when("customer", () => {
            const locale = input.invoice.document.locale;
            const asksForPayment = InvoiceSettlement.$is("PaymentRequested")(
              getInvoiceSettlement(input.invoice.document)
            );
            const manualBody = asksForPayment
              ? m.invoiceManualEmailBodyPaymentDetails(
                  { invoiceNumber: input.invoice.invoiceNumber },
                  { locale }
                )
              : m.invoiceManualEmailBody(
                  { invoiceNumber: input.invoice.invoiceNumber },
                  { locale }
                );
            return {
              body: manualDocument
                ? manualBody
                : m.invoiceEmailBody(
                    {
                      invoiceNumber: input.invoice.invoiceNumber,
                      orderId: input.invoice.workspaceReservationId ?? "",
                    },
                    { locale }
                  ),
              category: invoiceCustomerEmailCategory,
              heading: m.invoiceEmailHeading({}, { locale }),
              locale,
              formatSubject: (subject: string) => subject,
            };
          }),
          Match.when("internal", () => {
            return {
              body: manualDocument
                ? m.invoiceManualEmailInternalBody(
                    { invoiceNumber: input.invoice.invoiceNumber },
                    { locale: internalInvoiceLocale }
                  )
                : m.invoiceEmailInternalBody(
                    {
                      invoiceNumber: input.invoice.invoiceNumber,
                      orderId: input.invoice.workspaceReservationId ?? "",
                    },
                    { locale: internalInvoiceLocale }
                  ),
              category: invoiceInternalEmailCategory,
              heading: m.invoiceEmailInternalHeading(
                {},
                { locale: internalInvoiceLocale }
              ),
              locale: internalInvoiceLocale,
              formatSubject: internalWorkspaceEmailSubject,
            };
          }),
          Match.exhaustive
        );
        const title = m.invoiceTitle({}, { locale: content.locale });
        const preview = `${title} ${input.invoice.invoiceNumber}`;
        const { pdf, rendered } = yield* Effect.all({
          pdf: input.renderPdf.pipe(
            Effect.mapError((cause) =>
              deliveryError({
                code: "pdf_render_failed",
                paymentAttemptId:
                  input.invoice.paymentAttemptId ?? input.invoice.id,
                message: "Invoice PDF could not be rendered for delivery.",
                cause,
              })
            )
          ),
          rendered: renderWorkspaceEmail(
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
                paymentAttemptId:
                  input.invoice.paymentAttemptId ?? input.invoice.id,
                message: "Invoice delivery email could not be rendered.",
                cause,
              })
            )
          ),
        }).pipe(
          Effect.catch((error) =>
            failDelivery({
              deliveries,
              claim,
              invoice: input.invoice,
              audience: input.audience,
              error,
            })
          )
        );

        const message: EmailMessage = {
          from: emailConfig.defaultFrom,
          to: input.recipient,
          replyTo: workspaceEmailRecipient,
          subject: content.formatSubject(preview),
          html: rendered.html,
          text: rendered.text,
          idempotencyKey: input.resend
            ? `workspace-invoice-customer-resend-${input.invoice.id}-${claim.attemptNumber}`
            : `${content.category}-${input.invoice.id}`,
          attachments: [
            {
              filename: `${input.invoice.invoiceNumber}.pdf`,
              content: pdf,
              contentType: "application/pdf",
            },
          ],
          tags: [content.category],
          metadata: {
            deploymentEnvironment: env.VERCEL_ENV,
            source: "workspace-invoice-delivery",
            ...(input.invoice.workspaceReservationId && {
              workspaceReservationId: input.invoice.workspaceReservationId,
            }),
            invoiceId: input.invoice.id,
            audience: input.audience,
          },
        };

        const sendResult = yield* emailService.send(message).pipe(
          Effect.filterOrFail(
            (result) => result.status !== "failed",
            () => new EmailServiceError("Email provider rejected delivery.")
          ),
          Effect.catch((cause) =>
            failDelivery({
              deliveries,
              claim,
              invoice: input.invoice,
              audience: input.audience,
              error: deliveryError({
                code: "email_delivery_failed",
                paymentAttemptId:
                  input.invoice.paymentAttemptId ?? input.invoice.id,
                message: "Invoice email delivery failed.",
                cause,
              }),
            })
          )
        );

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
                paymentAttemptId:
                  input.invoice.paymentAttemptId ?? input.invoice.id,
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

        return yield* loadInvoiceDelivery(invoice);
      });

      const loadInvoiceDelivery = Effect.fn(
        "InvoiceEmailDeliveryService.loadInvoiceDelivery"
      )(function* (invoice: Invoice) {
        if (isManualInvoiceDocument(invoice.document)) {
          return {
            invoice,
            recipient: invoice.document.delivery.email,
            renderPdf: yield* Effect.cached(renderInvoicePdf(invoice.document)),
          };
        }

        if (!invoice.paymentAttemptId) {
          return yield* deliveryError({
            code: "invoice_load_failed",
            paymentAttemptId: invoice.id,
            message: "Reservation invoice payment reference is unavailable.",
          });
        }
        const paymentAttemptId = invoice.paymentAttemptId;

        const source = yield* accountingSnapshots
          .findByPaymentAttemptId(paymentAttemptIdSchema.make(paymentAttemptId))
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

        return {
          invoice,
          recipient: source.delivery.email,
          renderPdf: yield* Effect.cached(renderInvoicePdf(invoice.document)),
        };
      });

      const deliverLoaded = Effect.fn(
        "InvoiceEmailDeliveryService.deliverLoaded"
      )(function* (
        delivery: NonNullable<
          Effect.Success<ReturnType<typeof loadInvoiceDelivery>>
        >
      ) {
        const customer = yield* deliverAudience({
          invoice: delivery.invoice,
          audience: "customer",
          recipient: { email: delivery.recipient },
          renderPdf: delivery.renderPdf,
        }).pipe(settleDelivery);
        const internal = yield* deliverAudience({
          invoice: delivery.invoice,
          audience: "internal",
          recipient: internalWorkspaceEmailRecipientFor(delivery.recipient),
          renderPdf: delivery.renderPdf,
        }).pipe(settleDelivery);

        if (!customer.success) return yield* customer.error;
        if (!internal.success) {
          return yield* deliveryError({
            code: internal.error.code,
            paymentAttemptId:
              delivery.invoice.paymentAttemptId ?? delivery.invoice.id,
            message: internal.error.message,
            customerDelivered: customer.value,
            cause: internal.error,
          });
        }
        return {
          status: "delivered",
          changed: customer.value || internal.value,
        } as const;
      });

      const deliverByInvoiceId = Effect.fn(
        "InvoiceEmailDeliveryService.deliverByInvoiceId"
      )(function* ({ invoiceId }: { readonly invoiceId: string }) {
        const invoice = yield* invoices.findById(invoiceId).pipe(
          Effect.mapError((cause) =>
            deliveryError({
              code: "invoice_load_failed",
              paymentAttemptId: invoiceId,
              message: "Issued invoice could not be loaded for delivery.",
              cause,
            })
          )
        );
        if (!invoice) return { status: "not_issued" } as const;
        return yield* loadInvoiceDelivery(invoice).pipe(
          Effect.flatMap(deliverLoaded)
        );
      });

      return {
        deliverByInvoiceId,
        deliverByPaymentAttemptId: Effect.fn(
          "InvoiceEmailDeliveryService.deliverByPaymentAttemptId"
        )(function* ({ paymentAttemptId }) {
          const delivery = yield* loadDelivery(paymentAttemptId);
          if (!delivery) return { status: "not_issued" } as const;
          return yield* deliverLoaded(delivery);
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
            renderPdf: delivery.renderPdf,
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

  static Live = this.Default.pipe(
    Layer.provide(getInvoiceEmailDeliveryDependencies())
  );
}

function getInvoiceEmailDeliveryDependencies() {
  const accountingStorage = Layer.merge(
    WorkspaceDatabase.Default,
    AccountingSnapshotKeyService.Default
  );
  const accountingSnapshots = AccountingDocumentSnapshotRepository.Default.pipe(
    Layer.provide(accountingStorage)
  );
  const invoices = InvoiceRepository.Default.pipe(
    Layer.provide(Layer.merge(accountingStorage, accountingSnapshots))
  );

  return Layer.mergeAll(
    accountingSnapshots,
    invoices,
    InvoiceEmailDeliveryRepository.Live,
    WorkspaceEmailLayer
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
  readonly error: InvoiceEmailDeliveryError;
}) =>
  input.deliveries
    .markFailed({
      invoiceId: input.invoice.id,
      audience: input.audience,
      attemptNumber: input.claim.attemptNumber,
      failureCode:
        input.error.code === "pdf_render_failed"
          ? "pdf_render_failed"
          : "email_send_failed",
    })
    .pipe(
      Effect.mapError((cause) =>
        deliveryError({
          code: "persistence_failed",
          paymentAttemptId: input.invoice.paymentAttemptId ?? input.invoice.id,
          message: "Failed invoice email delivery was not recorded.",
          cause,
        })
      ),
      Effect.andThen(Effect.fail(input.error))
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
