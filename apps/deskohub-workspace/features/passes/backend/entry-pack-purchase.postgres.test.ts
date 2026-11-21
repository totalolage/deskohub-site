import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import {
  EmailConfigTag,
  EmailDeliveryIdSchema,
  type EmailMessage,
  EmailServiceError,
  EmailServiceTag,
} from "@deskohub/email";
import {
  ExternalAPIError,
  NetworkError,
  NexiOperationIdSchema,
  NexiService,
} from "@deskohub/nexi";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import { TestClock } from "effect/testing";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { promotionCodes, vouchers } from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import {
  CurrentCustomerAccount,
  requireVerifiedIdentity,
} from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import {
  CustomerAccountSections,
  HeldCustomerAccount,
} from "@/features/account/backend/customer-account-sections";
import { CustomerAuthentication } from "@/features/account/backend/customer-authentication.service";
import { testSessionProfile } from "@/features/account/backend/customer-authentication.test-utils";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { testAccountingStorage } from "@/features/accounting/backend/accounting-storage.test-utils";
import { InvoiceRepository } from "@/features/accounting/backend/invoice.repository";
import { InvoiceCancellationNotices } from "@/features/accounting/backend/invoice-cancellation-notices";
import { InvoiceEmailDeliveryRepository } from "@/features/accounting/backend/invoice-email-delivery.repository";
import { InvoiceEmailDeliveryService } from "@/features/accounting/backend/invoice-email-delivery.service";
import { companyRegistrationIdSchema } from "@/features/accounting/billing-identity";
import { getInvoicePresentation } from "@/features/accounting/invoice-presentation";
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics/checkout-analytics.service";
import { PaymentPageProviderStatus } from "@/features/checkout/backend/checkout/payment-page-provider-status";
import { LatePaymentVerificationService } from "@/features/checkout/backend/payment/late-payment-verification.service";
import { NexiWebhookService } from "@/features/checkout/backend/payment/nexi-webhook.service";
import { OrderPaymentHandlers } from "@/features/checkout/backend/payment/order-payment-handlers.service";
import { PaymentProvidersFromNexi } from "@/features/checkout/backend/payment/payment-providers";
import { PaymentRefundService } from "@/features/checkout/backend/payment/payment-refund.service";
import { ProviderPaymentFinalizationService } from "@/features/checkout/backend/payment/provider-payment-finalization.service";
import { LegalEvidenceEventRepository } from "@/features/checkout/backend/repositories/legal-evidence-event.repository";
import { PaymentAttemptRepository } from "@/features/checkout/backend/repositories/payment-attempt.repository";
import { WebhookEventRepository } from "@/features/checkout/backend/repositories/webhook-event.repository";
import { paymentAttemptIdSchema } from "@/features/checkout/checkout-identifiers";
import { calculateDiscounts } from "@/features/discounts/calculator";
import { makeDiscountCommitment } from "@/features/discounts/commitment";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import { DiscountService } from "@/features/discounts/discount.service";
import { deriveOpaqueDiscountId } from "@/features/discounts/opaque-discount-id";
import type { DiscountCandidate } from "@/features/discounts/provider";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { m } from "@/features/i18n";
import { orderIdSchema } from "@/features/order";
import { findOrderKind } from "@/features/order/backend/order-kind";
import type { ReservationBillingSelection } from "@/features/reservation/reservation-billing";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import { currencyCZK } from "@/shared/money/currencies";
import { fixtureReservationAuthorId as accountId } from "@/shared/testing/workspace-fixtures.test-utils";
import {
  createWorkspacePostgresSuiteDatabase,
  type WorkspacePostgresSuiteDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { atInstant } from "@/shared/testing/workspace-test-clock.test-utils";
import { passPurchaseQuoteCodec } from "../pass-purchase-quote";
import { CoworkPassesReleaseGate } from "./cowork-passes-release-gate";
import {
  claimEntryPackGifts,
  queueEntryPackGiftResend,
  readEntryPackGiftState,
  resolveEntryPackGiftInvitation,
} from "./entry-pack-gift";
import { requestEntryPackGiftResend } from "./entry-pack-gift-resend";
import { readOwnedPassPurchaseOrderLocale } from "./entry-pack-order";
import { makeEntryPackOrderPaymentHandler } from "./entry-pack-order-payment-handler";
import {
  beginEntryPackPurchase,
  displayPassPurchasePrice,
  getEntryPackPaymentDisclosure,
  getPassPurchasePriceFingerprint,
  payForEntryPack,
  readEntryPackPaymentRetry,
  repriceEntryPackPurchase,
} from "./entry-pack-purchase";
import { loadEntryPackRedemption } from "./entry-pack-redemption";
import { settlePassPurchase } from "./entry-pack-settlement";
import { loadEntryPackStatus } from "./entry-pack-status";
import { reconcilePassPurchases } from "./pass-purchase-reconciliation";

describe.skipIf(!process.env.WORKSPACE_TEST_DATABASE_URL)(
  "Entry pack purchase",
  () => {
    let database: WorkspacePostgresSuiteDatabase | null;
    beforeAll(async () => {
      database = await createWorkspacePostgresSuiteDatabase(
        "entry_pack_purchase"
      );
      await database?.pool.query(
        'insert into auth."user" (id, name, email, email_verified) values ($1, $2, $3, true)',
        [accountId, "", email]
      );
    });
    afterAll(async () => {
      await database?.close();
    });

    const email = testEmailAddress("pass-buyer");
    const dotyposCustomerId = DotyposCustomerIdSchema.make("pass-buyer");
    const session = {
      accountId,
      email,
      deletionRequested: false,
      ...testSessionProfile,
    };
    const purchaseServices = Layer.mergeAll(
      Layer.mock(CurrentCustomerAccount, {
        requireActive: Effect.succeed(session),
        peek: Effect.succeed({
          kind: "linked",
          account: { accountId, dotyposCustomerId },
          session,
          autoLinked: false,
          reviewMarker: "absent",
        } as const),
      }),
      Layer.mock(CustomerAccountSections, {
        withActiveAccount: (_buyerId, operation) =>
          Effect.provideService(operation, HeldCustomerAccount, {
            accountId,
            email,
          }),
      }),
      Layer.mock(CustomerAccountContactService, {
        linkedContact: () =>
          Effect.succeed({
            accountId,
            dotyposCustomerId,
            email,
            name: "Fixture Buyer",
            phone: null,
          }),
      }),
      Layer.mock(WorkspaceFeatureFlagService, {
        isEnabled: () => Effect.succeed(true),
      }),
      Layer.mock(DiscountService, {
        quote: (input) =>
          calculateDiscounts({ ...input, candidates: [] }).pipe(
            Effect.map(({ quote }) => quote)
          ),
      })
    );

    test("only the active buyer can resolve an Entry pack order's locale", async () => {
      const db = database!;
      const orderId = orderIdSchema.make(crypto.randomUUID());
      await Effect.runPromise(
        beginEntryPackPurchase({
          orderId,
          product: { kind: "entry-pack", tier: "open-space", size: 5 },
          locale: "en-US",
        }).pipe(Effect.provide(Layer.mergeAll(db.layer, purchaseServices)))
      );

      const localeFor = (viewer: typeof session | null, id = orderId) =>
        Effect.runPromise(
          readOwnedPassPurchaseOrderLocale(id, "entry-pack").pipe(
            Effect.provide(
              Layer.mergeAll(
                db.layer,
                Layer.mock(CurrentCustomerAccount, {
                  requireActive: requireVerifiedIdentity(viewer),
                })
              )
            )
          )
        );

      expect(await localeFor(session)).toBe("en-US");
      expect(
        await localeFor({
          ...session,
          accountId: customerAccountIdSchema.make(crypto.randomUUID()),
        })
      ).toBeUndefined();
      expect(
        await localeFor({ ...session, deletionRequested: true })
      ).toBeUndefined();
      expect(await localeFor(null)).toBeUndefined();
      expect(
        await localeFor(session, orderIdSchema.make(crypto.randomUUID()))
      ).toBeUndefined();
    });

    const integration = async (
      db: WorkspacePostgresSuiteDatabase,
      voucherValue: number,
      purchasedAt?: Temporal.Instant,
      billing?: ReservationBillingSelection,
      otherDiscount?: DiscountCandidate,
      holderEmail?: string
    ) => {
      const code = canonicalPromotionCodeSchema.make(
        `V${crypto.randomUUID().replaceAll("-", "").slice(0, 16).toUpperCase()}`
      );
      const [promotion] = await Effect.runPromise(
        db.db
          .insert(promotionCodes)
          .values({ kind: "voucher", code, enabled: true })
          .returning()
      );
      const [voucher] = await Effect.runPromise(
        db.db
          .insert(vouchers)
          .values({
            promotionCodeId: promotion!.id,
            issuedAmountValue: voucherValue,
            issuedAmountExponent: 2,
            issuedAmountCurrency: "CZK",
          })
          .returning()
      );
      const amount = currencyCZK(voucherValue);
      let discountAvailable = true;
      let replacementProviderReference: string | undefined;
      let affirmedCode: typeof code | undefined;
      const candidate: DiscountCandidate = {
        discount: {
          id: deriveOpaqueDiscountId({
            providerNamespace: "database-voucher",
            providerReference: voucher!.id,
          }),
          label: m.checkoutVoucherLabel({}, { locale: "en-US" }),
          adjustment: { kind: "fixed", amount },
        },
        provenance: {
          providerNamespace: "database-voucher",
          providerReference: voucher!.id,
          details: { voucherId: voucher!.id },
        },
        claim: {
          kind: "voucher",
          voucherId: voucher!.id,
          availableAmount: amount,
          dotyposCustomerId,
        },
      };
      const mail: EmailMessage[] = [];
      const invitations: EmailMessage[] = [];
      const attemptedKeys: (string | undefined)[] = [];
      let failSend = false;
      let failInvitationSend = false;
      let failInternalInvoice = false;
      let beforeAdmission = Effect.void;
      const rejectedConfirmations = new Set<string>();
      const inconclusiveProviderOrders = new Set<string>();
      let buyerName = "Fixture Buyer";
      const invoiceDeliveries = new Set<string>();
      const key = {
        id: accountingSnapshotKeyIdSchema.make("PASS_TEST"),
        secret: "synthetic pass accounting key for PostgreSQL",
      };
      const accounting = testAccountingStorage(
        db.layer,
        Layer.succeed(AccountingSnapshotKeyService, {
          getActive: Effect.succeed(key),
          getById: () => Effect.succeed(key),
        })
      );
      const deliveryAttempts: string[] = [];
      // Use the smallest supported lock permit budget. A nested account/order
      // acquisition exhausts it even when SQL queries have spare connections.
      const fulfillmentLockLayer = WorkspaceDatabaseAdvisoryLock.makeLayer({
        ...db.databasePool,
        maxConnections: 2,
      });
      const backgroundAccountSections = CustomerAccountSections.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            CustomerAccountLinkRepository.Default.pipe(Layer.provide(db.layer)),
            fulfillmentLockLayer,
            Layer.mock(CustomerAuthentication, {
              currentUser: Effect.succeed(session),
            })
          )
        )
      );
      const emailLayer = Layer.merge(
        Layer.succeed(EmailConfigTag, {
          defaultFrom: { email: testEmailAddress("pass-sender") },
        }),
        Layer.mock(EmailServiceTag, {
          send: (message) =>
            Effect.suspend(() => {
              const key = message.idempotencyKey ?? "";
              if (key.startsWith("entry-pack-gift-invitation:")) {
                invitations.push(message);
                if (failInvitationSend) {
                  failInvitationSend = false;
                  return Effect.fail(
                    new EmailServiceError(
                      "Synthetic uncertain gift delivery.",
                      undefined,
                      undefined,
                      {
                        failureKind: "unknown-outcome",
                      }
                    )
                  );
                }
              } else if (key.startsWith("entry-pack-purchase:")) {
                attemptedKeys.push(key);
                if (failSend || rejectedConfirmations.has(key)) {
                  failSend = false;
                  return Effect.fail(
                    new EmailServiceError("Synthetic confirmation failure.")
                  );
                }
                mail.push(message);
              } else {
                deliveryAttempts.push(key);
                if (
                  key.startsWith("workspace-invoice-internal-") &&
                  failInternalInvoice
                ) {
                  failInternalInvoice = false;
                  return Effect.fail(
                    new EmailServiceError("Synthetic internal invoice failure.")
                  );
                }
                if (key.startsWith("workspace-invoice-customer-")) {
                  invoiceDeliveries.add(
                    key.slice("workspace-invoice-customer-".length)
                  );
                }
              }
              return Effect.succeed({
                id: EmailDeliveryIdSchema.make(crypto.randomUUID()),
                status: "sent" as const,
                provider: "fixture",
                timestamp: new Date(),
              });
            }),
        })
      );
      const invoiceDeliveryLedger = InvoiceEmailDeliveryRepository.Default.pipe(
        Layer.provide(db.layer)
      );
      const invoiceDelivery = InvoiceEmailDeliveryService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            accounting,
            emailLayer,
            invoiceDeliveryLedger,
            Layer.mock(InvoiceCancellationNotices, {
              ensureOwed: () => Effect.void,
            })
          )
        )
      );
      const { layer } = await Effect.runPromise(
        Effect.gen(function* () {
          const handler = yield* makeEntryPackOrderPaymentHandler;
          return {
            layer: Layer.succeed(
              OrderPaymentHandlers,
              OrderPaymentHandlers.make(
                { "pass-purchase": handler },
                (orderId) =>
                  findOrderKind(orderId).pipe(Effect.provide(db.layer))
              )
            ),
          };
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              db.layer,
              accounting,
              invoiceDeliveryLedger,
              invoiceDelivery,
              emailLayer,
              backgroundAccountSections,
              fulfillmentLockLayer
            )
          )
        )
      );
      const providerOrders: string[] = [];
      const verifiedOrders: string[] = [];
      let captured = true;
      let priorClosureVerified = false;
      let abandoned = false;
      let failCreation = false;
      const infrastructure = Layer.mergeAll(
        db.layer,
        purchaseServices,
        layer,
        accounting,
        Layer.mock(CustomerAccountContactService, {
          linkedContact: () =>
            Effect.sync(() => ({
              accountId,
              dotyposCustomerId,
              email,
              name: buyerName,
              phone: null,
            })),
        }),
        Layer.mock(PaymentPageProviderStatus, {
          observe: () => Effect.succeed("no_activity"),
        }),
        LegalEvidenceEventRepository.Default.pipe(Layer.provide(db.layer)),
        PaymentAttemptRepository.Default.pipe(Layer.provide(db.layer)),
        WebhookEventRepository.Default.pipe(Layer.provide(db.layer)),
        Layer.mock(PaymentRefundService, {}),
        Layer.mock(CheckoutAnalytics, {
          paymentStarted: () => Effect.void,
          paymentCompleted: () => Effect.void,
          paymentFailed: () => Effect.void,
          paymentAbandoned: () => Effect.void,
        }),
        Layer.mock(DiscountService, {
          applyDiscountCode: ({ baseQuote }) =>
            Effect.succeed({
              quote: baseQuote,
              application: baseQuote.discounts.find(
                ({ discount }) => discount.id === candidate.discount.id
              )!,
            }),
          quote: (input) =>
            calculateDiscounts({
              ...input,
              candidates: otherDiscount
                ? [otherDiscount, candidate]
                : [candidate],
            }).pipe(
              Effect.map(({ quote }) => ({
                ...quote,
                submittedCodeDiscountId: candidate.discount.id,
              }))
            ),
          affirmDisplayedDiscounts: (input) =>
            calculateDiscounts({
              ...input,
              candidates: [
                ...(otherDiscount ? [otherDiscount] : []),
                ...(discountAvailable
                  ? [
                      {
                        ...candidate,
                        provenance: {
                          ...candidate.provenance,
                          providerReference:
                            replacementProviderReference ??
                            candidate.provenance.providerReference,
                        },
                      },
                    ]
                  : []),
              ],
            }).pipe(
              Effect.map(({ quote, applications }) => ({
                quote,
                commitment: makeDiscountCommitment({
                  product: input.product,
                  firstServiceDate: input.firstServiceDate,
                  applications,
                }),
              })),
              Effect.tap(() => {
                affirmedCode = input.submittedCode;
                return beforeAdmission;
              })
            ),
        }),
        PaymentProvidersFromNexi.pipe(
          Layer.provide(
            Layer.mock(NexiService, {
              createHostedPaymentPage: ({ orderId }) =>
                Effect.suspend(() => {
                  providerOrders.push(orderId);
                  if (failCreation) {
                    failCreation = false;
                    return Effect.fail(
                      new NetworkError({
                        message: "Synthetic ambiguous Nexi creation",
                      })
                    );
                  }
                  return Effect.succeed({
                    orderId,
                    hostedPage: "https://nexi.test/payment",
                    securityToken: "synthetic-session",
                  });
                }),
              getOrder: () =>
                Effect.fail(
                  new ExternalAPIError({
                    service: "Nexi",
                    operation: "Get order",
                    statusCode: 404,
                  })
                ),
              verifyPaymentOutcome: (input) => {
                verifiedOrders.push(input.orderId);
                if (inconclusiveProviderOrders.has(input.orderId)) {
                  return Effect.fail(
                    new NetworkError({
                      message: "Synthetic inconclusive order",
                    })
                  );
                }
                const settledStatus = captured ? "success" : "failure";
                const settledOrderStatus = captured ? "EXECUTED" : "DECLINED";
                return Effect.succeed({
                  status: abandoned ? "pending" : settledStatus,
                  provider: {
                    orderId: input.orderId,
                    operationId: abandoned
                      ? undefined
                      : NexiOperationIdSchema.make("synthetic-operation"),
                    operationCount: abandoned ? 0 : 1,
                    amount: input.amount,
                    authorizedAmount: undefined,
                    capturedAmount:
                      captured && !abandoned ? input.amount : undefined,
                    currency: input.currency,
                    orderStatus: abandoned ? undefined : settledOrderStatus,
                    captureExecuted: captured && !abandoned,
                  },
                  mismatches: [],
                });
              },
            })
          )
        )
      );
      // The synthetic provider can model a closure proof. The production Nexi
      // adapter does not infer this guarantee from an unsuccessful verification.
      const retryVerification = Layer.effect(
        LatePaymentVerificationService,
        Effect.gen(function* () {
          const verification = yield* LatePaymentVerificationService;
          return LatePaymentVerificationService.of({
            startRecoveryIfSettled: (input) =>
              verification
                .startRecoveryIfSettled(input)
                .pipe(
                  Effect.map((result) =>
                    priorClosureVerified && result === "not_settled"
                      ? ("confirmed_unpaid" as const)
                      : result
                  )
                ),
          });
        })
      ).pipe(
        Layer.provide(
          LatePaymentVerificationService.Default.pipe(
            Layer.provide(infrastructure)
          )
        )
      );
      const services = Layer.merge(infrastructure, retryVerification);
      const orderId = orderIdSchema.make(crypto.randomUUID());
      const begin = beginEntryPackPurchase({
        orderId,
        product: { kind: "entry-pack", tier: "open-space", size: 5 },
        locale: "en-US",
        submittedCode: code,
        ...(holderEmail && { holderEmail }),
      }).pipe(Effect.provide(services));
      const initialPurchase = await Effect.runPromise(
        purchasedAt ? begin.pipe(atInstant(purchasedAt)) : begin
      );
      const initialQuote = Schema.decodeSync(passPurchaseQuoteCodec)(
        initialPurchase.quote
      );
      const accept = {
        orderId,
        accepted: true,
        acceptedDocuments: getEntryPackPaymentDisclosure("en-US").documents,
        submittedCode: code,
      };
      const notify = async (payment: "failure" | "success", attempt = 0) => {
        captured = payment === "success";
        abandoned = false;
        await Effect.runPromise(
          Effect.flatMap(NexiWebhookService, (webhook) =>
            webhook.processNotification({
              eventId: crypto.randomUUID(),
              securityToken: "synthetic-session",
              operation: {
                orderId: providerOrders[attempt],
                operationId: crypto.randomUUID(),
                operationType: "CAPTURE",
                operationResult: captured ? "EXECUTED" : "DECLINED",
                operationAmount: String(115_000 - voucherValue),
                operationCurrency: "CZK",
              },
            })
          ).pipe(
            Effect.provide(
              NexiWebhookService.Default.pipe(Layer.provide(services))
            )
          )
        );
      };
      return {
        orderId,
        initialPurchase,
        mail,
        invitations,
        attemptedKeys,
        invoiceDeliveries,
        deliveryAttempts,
        rejectInternalInvoice: () => {
          failInternalInvoice = true;
        },
        rejectConfirmationFor: (id: string) => {
          rejectedConfirmations.add(`entry-pack-purchase:${id}`);
        },
        makeOrderInconclusive: (id: string) => {
          inconclusiveProviderOrders.add(id);
        },
        advanceDuringPay: () => {
          beforeAdmission = TestClock.adjust("2 seconds");
        },
        changeBuyerName: (name: string) => {
          buyerName = name;
        },
        abandonProviderOrder: () => {
          abandoned = true;
        },
        confirmProviderOrderEnded: () => {
          abandoned = false;
          captured = false;
          priorClosureVerified = true;
        },
        rejectNextCreation: () => {
          failCreation = true;
        },
        reconcile: (now: Temporal.Instant, limit = 25) =>
          Effect.runPromise(
            reconcilePassPurchases({ now, limit }).pipe(
              Effect.provide(ProviderPaymentFinalizationService.Default),
              Effect.provide(services),
              atInstant(now)
            )
          ),
        readAccounting: (attemptId: string, invoiceId?: string) =>
          Effect.runPromise(
            Effect.gen(function* () {
              const snapshots = yield* AccountingDocumentSnapshots;
              const invoices = yield* InvoiceRepository;
              return {
                snapshot: yield* snapshots.findPassPurchase(
                  paymentAttemptIdSchema.make(attemptId)
                ),
                invoice: invoiceId ? yield* invoices.findById(invoiceId) : null,
              };
            }).pipe(Effect.provide(accounting))
          ),
        rejectNextEmail: () => {
          failSend = true;
        },
        rejectNextInvitation: () => {
          failInvitationSend = true;
        },
        resendAsBuyer: (at: Temporal.Instant, signal: AbortSignal) =>
          Effect.runPromise(
            requestEntryPackGiftResend(orderId).pipe(
              Effect.provide(backgroundAccountSections),
              Effect.provide(
                Layer.mergeAll(
                  db.layer,
                  purchaseServices,
                  CoworkPassesReleaseGate.fromDecision(true)
                )
              ),
              atInstant(at)
            ),
            { signal }
          ),
        providerOrders,
        verifiedOrders,
        status: () =>
          Effect.runPromise(
            loadEntryPackStatus(orderId).pipe(
              Effect.provide(ProviderPaymentFinalizationService.Default),
              Effect.provide(services)
            )
          ),
        openRetry: (destination: string) => {
          const path = new URL(destination, "https://example.invalid");
          expect(path.pathname).toBe("/en-US/passes/entry-pack");
          expect(path.searchParams.get("step")).toBe("pay");
          const retryOrderId = orderIdSchema.make(
            path.searchParams.get("order")!
          );
          expect(retryOrderId).toBe(orderId);
          return Effect.runPromise(
            readEntryPackPaymentRetry(retryOrderId).pipe(
              Effect.provide(services)
            )
          );
        },
        retryApproval: async () => {
          const status = await Effect.runPromise(
            loadEntryPackStatus(orderId).pipe(
              Effect.provide(ProviderPaymentFinalizationService.Default),
              Effect.provide(services)
            )
          );
          if (!("retryPath" in status && status.retryPath))
            throw new Error("Missing retry destination");
          const retry = await Effect.runPromise(
            readEntryPackPaymentRetry(orderId).pipe(Effect.provide(services))
          );
          if (retry.kind !== "retry") throw new Error("Missing retry approval");
          return { priorPaymentAttemptId: retry.priorPaymentAttemptId };
        },
        evidenceCount: async () =>
          (
            await db.pool.query(
              "select 1 from legal_evidence_events where order_id = $1",
              [orderId]
            )
          ).rowCount,
        alignTwoPaySubmissions: () => {
          const bothReady = Promise.withResolvers<void>();
          let arrived = 0;
          beforeAdmission = Effect.promise(async () => {
            if (++arrived === 2) bothReady.resolve();
            await bothReady.promise;
          });
        },
        notify,
        readAffirmedCode: () => affirmedCode,
        initialQuote,
        initialFingerprint: getPassPurchasePriceFingerprint(initialQuote),
        reprice: (
          displayedPriceFingerprint: string,
          submittedCode?: typeof code
        ) =>
          Effect.runPromise(
            repriceEntryPackPurchase({
              orderId,
              displayedPriceFingerprint,
              ...(submittedCode && { submittedCode }),
            }).pipe(Effect.provide(services))
          ),
        removeDiscount: () => {
          discountAvailable = false;
        },
        reassignCode: () => {
          replacementProviderReference = crypto.randomUUID();
        },
        pay: (
          at?: Temporal.Instant,
          options?: {
            billing?: ReservationBillingSelection;
            accepted?: boolean;
            priorPaymentAttemptId?: ReturnType<
              typeof paymentAttemptIdSchema.make
            >;
            displayedPriceFingerprint?: string;
            acceptedDocuments?: typeof accept.acceptedDocuments;
            submittedCode?: typeof code;
          },
          signal?: AbortSignal
        ) => {
          const pay = payForEntryPack({
            ...accept,
            ...(billing && { billing }),
            ...options,
          }).pipe(Effect.provide(services));
          return Effect.runPromise(at ? pay.pipe(atInstant(at)) : pay, {
            signal,
          });
        },
      };
    };

    const requestedInvoice = {
      purpose: "personal",
      invoice: "requested",
      address: {
        line1: "Synthetic 8",
        city: "Praha",
        postalCode: "11000",
        country: "CZ",
      },
    } satisfies ReservationBillingSelection;

    test("saves current pricing before the first attempt and requires the buyer to see it", async () => {
      const payment = await integration(database!, 2_000);
      payment.removeDiscount();

      const refreshed = await payment.pay();
      expect(refreshed.status).toBe("pricing_changed");
      expect(payment.providerOrders).toHaveLength(0);
      if (refreshed.status !== "pricing_changed")
        throw new Error("Missing refreshed price");
      const stale = await payment.pay(undefined, {
        displayedPriceFingerprint: "0".repeat(64),
      });
      expect(stale).toEqual(refreshed);
      expect(payment.providerOrders).toHaveLength(0);

      expect(
        await payment.pay(undefined, {
          displayedPriceFingerprint: getPassPurchasePriceFingerprint(
            refreshed.quote
          ),
        })
      ).toMatchObject({ status: "hosted" });
      expect(payment.providerOrders).toHaveLength(1);
      await payment.notify("failure");
    });

    test("drops the applied-code label when only the customer discount survives repricing", async () => {
      const customerDiscount = {
        discount: {
          id: deriveOpaqueDiscountId({
            providerNamespace: "dotypos-customer",
            providerReference: dotyposCustomerId,
          }),
          label: "Customer discount",
          adjustment: { kind: "fixed", amount: currencyCZK(1_000) },
        },
        provenance: {
          providerNamespace: "dotypos-customer",
          providerReference: dotyposCustomerId,
        },
      } satisfies DiscountCandidate;
      const payment = await integration(
        database!,
        2_000,
        undefined,
        undefined,
        customerDiscount
      );
      const code = payment.initialQuote.selection?.submittedCode;
      expect(code).toBeDefined();
      expect(displayPassPurchasePrice(payment.initialQuote)).toHaveProperty(
        "appliedDiscountCode",
        code
      );

      const { submittedCodeDiscountId, ...legacyQuote } = payment.initialQuote;
      expect(submittedCodeDiscountId).toBeDefined();
      const legacyStoredQuote = Schema.decodeSync(passPurchaseQuoteCodec)(
        Schema.encodeSync(passPurchaseQuoteCodec)(legacyQuote)
      );
      expect(legacyStoredQuote.selection?.submittedCode).toBe(code);
      expect(getPassPurchasePriceFingerprint(legacyStoredQuote)).toBe(
        payment.initialFingerprint
      );
      expect(displayPassPurchasePrice(legacyStoredQuote)).not.toHaveProperty(
        "appliedDiscountCode"
      );

      payment.removeDiscount();
      const refreshed = await payment.pay();
      if (refreshed.status !== "pricing_changed")
        throw new Error("Missing refreshed price");
      expect(refreshed.quote.selection?.submittedCode).toBe(code);
      expect(
        refreshed.quote.discounts.map(({ discount }) => discount.id)
      ).toEqual([customerDiscount.discount.id]);
      expect(refreshed.quote).not.toHaveProperty("submittedCodeDiscountId");
      expect(displayPassPurchasePrice(refreshed.quote)).not.toHaveProperty(
        "appliedDiscountCode"
      );
      expect(payment.providerOrders).toHaveLength(0);
      expect(
        await payment.pay(undefined, {
          displayedPriceFingerprint: payment.initialFingerprint,
        })
      ).toEqual(refreshed);
    });

    test("keeps the first attempt's pricing and billing after an ended payment", async () => {
      const payment = await integration(
        database!,
        2_000,
        undefined,
        requestedInvoice
      );
      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      const approval = await payment.retryApproval();
      await expect(
        payment.pay(undefined, {
          ...approval,
          billing: { purpose: "personal", invoice: "none" },
        })
      ).rejects.toMatchObject({ reason: "billing-changed" });

      payment.removeDiscount();
      await expect(payment.pay(undefined, approval)).rejects.toMatchObject({
        reason: "payment-in-progress",
      });
      expect(payment.providerOrders).toHaveLength(1);
    });

    test("a same-price code change invalidates stale Remove and Pay, including hosted retries", async () => {
      const payment = await integration(database!, 2_000);
      const otherCode = canonicalPromotionCodeSchema.make("OTHER-CODE");
      const updated = await payment.reprice(
        payment.initialFingerprint,
        otherCode
      );
      expect(updated.status).toBe("ready");
      const fingerprint = getPassPurchasePriceFingerprint(updated.quote);
      expect(fingerprint).not.toBe(payment.initialFingerprint);
      const staleRemove = await payment.reprice(payment.initialFingerprint);
      expect(staleRemove).toEqual({
        status: "pricing_changed",
        quote: updated.quote,
      });

      const first = await payment.pay(undefined, {
        displayedPriceFingerprint: fingerprint,
      });
      expect(first).toMatchObject({ status: "hosted" });
      expect(payment.readAffirmedCode()).toBe(otherCode);
      const stale = await payment.pay(undefined, {
        displayedPriceFingerprint: payment.initialFingerprint,
      });
      expect(stale.status).toBe("pending");
      expect(stale).not.toHaveProperty("redirectUrl");
      expect(payment.providerOrders).toHaveLength(1);

      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      const approval = await payment.retryApproval();
      await expect(payment.reprice(fingerprint)).rejects.toMatchObject({
        reason: "payment-in-progress",
      });
      expect(
        await payment.pay(undefined, {
          displayedPriceFingerprint: fingerprint,
          submittedCode: canonicalPromotionCodeSchema.make("STALE-CODE"),
          ...approval,
        })
      ).toMatchObject({ status: "hosted" });
      expect(payment.readAffirmedCode()).toBe(otherCode);
      await payment.notify("failure", 1);
    });

    test("status resumes the original gift, verifies the prior charge and keeps billing while collecting fresh consent", async () => {
      const db = database!;
      const holderEmail = testEmailAddress("retry-gift-holder");
      const payment = await integration(
        db,
        2_000,
        undefined,
        requestedInvoice,
        undefined,
        holderEmail
      );
      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      const oldProviderOrder = payment.providerOrders[0]!;
      payment.verifiedOrders.length = 0;
      const ended = await payment.status();
      expect(ended.status).toBe("failed");
      expect(payment.verifiedOrders).toEqual([oldProviderOrder]);
      expect("retryPath" in ended && ended.retryPath).toBeTruthy();
      if (!("retryPath" in ended && ended.retryPath))
        throw new Error("Missing retry destination");
      const continuation = await payment.openRetry(ended.retryPath);
      expect(continuation).toMatchObject({
        kind: "retry",
        billing: requestedInvoice,
        holderEmail,
      });
      expect(payment.verifiedOrders).toEqual([
        oldProviderOrder,
        oldProviderOrder,
      ]);
      if (continuation.kind !== "retry") throw new Error("Missing retry Pay");
      const approval = {
        priorPaymentAttemptId: continuation.priorPaymentAttemptId,
      };
      payment.changeBuyerName("Changed Fixture Name");
      await expect(
        payment.pay(undefined, { ...approval, acceptedDocuments: [] })
      ).rejects.toMatchObject({
        reason: "terms-changed",
        locale: "en-US",
      });
      expect(payment.providerOrders).toHaveLength(1);
      expect(await payment.pay(undefined, approval)).toMatchObject({
        status: "hosted",
      });
      const attempts = await db.pool.query<{ id: string }>(
        "select id from payment_attempts where order_id = $1 order by created_at",
        [payment.orderId]
      );
      expect(attempts.rows).toHaveLength(2);
      const first = await payment.readAccounting(attempts.rows[0]!.id);
      const second = await payment.readAccounting(attempts.rows[1]!.id);
      expect(first.snapshot?.buyer).toBeDefined();
      expect(second.snapshot?.buyer).toEqual(first.snapshot?.buyer);
      expect(second.snapshot?.billing).toEqual(first.snapshot?.billing);
      expect(second.snapshot?.quote).toEqual(first.snapshot?.quote);
      expect(payment.verifiedOrders).toEqual(Array(4).fill(oldProviderOrder));

      await payment.notify("success");
      await payment.notify("success", 1);
      await payment.notify("success", 1);
      expect(await payment.status()).toMatchObject({
        status: "paid",
        gift: true,
      });
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      const issued = await db.pool.query(
        `select p.id from pass_purchases p join auth."user" u on u.id = p.holder_account_id
         where u.email = $1 and p.status = 'active'`,
        [holderEmail]
      );
      expect(issued.rows).toEqual([{ id: payment.orderId }]);
      expect(payment.providerOrders).toHaveLength(2);
    });

    test("an inconclusive terminal payment stays on private status and a late capture settles the original pack", async () => {
      const payment = await integration(database!, 2_000);
      await payment.pay();
      await payment.notify("failure");
      const checking = await payment.status();
      expect(checking).toMatchObject({ status: "checking" });
      expect(checking).not.toHaveProperty("retryPath");
      const replay = () => payment.pay();
      expect(await Promise.all([replay(), replay()])).toEqual([
        {
          status: "pending",
          statusUrl: `/en-US/reservation/status/${payment.orderId}`,
        },
        {
          status: "pending",
          statusUrl: `/en-US/reservation/status/${payment.orderId}`,
        },
      ]);
      expect(payment.providerOrders).toHaveLength(1);
      await payment.notify("success");
      expect(await payment.status()).toMatchObject({
        status: "paid",
        orderId: payment.orderId,
      });
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      expect(payment.providerOrders).toHaveLength(1);
    });

    test("an ended attempt cannot reserve a different promotion with the same code and price", async () => {
      const payment = await integration(database!, 2_000);
      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      const approval = await payment.retryApproval();
      payment.reassignCode();
      await expect(payment.pay(undefined, approval)).rejects.toMatchObject({
        reason: "payment-in-progress",
      });
      expect(payment.providerOrders).toHaveLength(1);
    });

    test("reconciliation rotates past an inconclusive Nexi order at batch size one", async () => {
      const db = database!;
      const first = await integration(db, 2_000);
      const next = await integration(db, 2_000);
      const now = Temporal.Now.instant();
      await first.pay(now);
      await next.pay(now.add({ seconds: 1 }));
      next.makeOrderInconclusive(first.providerOrders[0]!);
      next.abandonProviderOrder();
      const read = (orderId: string) =>
        db.pool
          .query(
            `select a.state, v.state as claim from payment_attempts a
         join voucher_redemptions v on v.payment_attempt_id = a.id where a.order_id = $1`,
            [orderId]
          )
          .then(({ rows }) => rows);
      const afterCutoff = now.add({ minutes: 31 });
      expect(await next.reconcile(afterCutoff, 1)).toMatchObject({
        paymentsChecked: 1,
      });
      expect(await read(next.orderId)).toEqual([
        { state: "pending", claim: "reserved" },
      ]);
      expect(
        await next.reconcile(afterCutoff.add({ minutes: 10 }), 1)
      ).toMatchObject({ paymentsChecked: 1 });
      expect(await read(first.orderId)).toEqual([
        { state: "pending", claim: "reserved" },
      ]);
      expect(await read(next.orderId)).toEqual([
        { state: "expired", claim: "released" },
      ]);
      first.abandonProviderOrder();
      await first.reconcile(afterCutoff.add({ minutes: 20 }), 1);
      expect(await read(first.orderId)).toEqual([
        { state: "expired", claim: "released" },
      ]);
    });

    test("reconciliation rotates past a failing confirmation at batch size one", async () => {
      const db = database!;
      const first = await integration(db, 115_000);
      const next = await integration(db, 115_000);
      const now = Temporal.Now.instant();
      first.rejectNextEmail();
      next.rejectNextEmail();
      await first.pay(now);
      await next.pay(now.add({ seconds: 1 }));
      next.rejectConfirmationFor(first.orderId);
      const read = (orderId: string) =>
        db.pool
          .query(
            "select payment_state, fulfillment_state from orders where id = $1",
            [orderId]
          )
          .then(({ rows }) => rows);
      const firstRetry = now.add({ minutes: 10 });
      expect(await next.reconcile(firstRetry, 1)).toMatchObject({
        fulfillmentRetried: 1,
      });
      expect(await read(next.orderId)).toEqual([
        { payment_state: "paid", fulfillment_state: "not_started" },
      ]);
      expect(
        await next.reconcile(firstRetry.add({ minutes: 10 }), 1)
      ).toMatchObject({ fulfillmentRetried: 1 });
      expect(await read(first.orderId)).toEqual([
        { payment_state: "paid", fulfillment_state: "not_started" },
      ]);
      expect(await read(next.orderId)).toEqual([
        { payment_state: "paid", fulfillment_state: "fulfilled" },
      ]);
      expect(next.mail).toHaveLength(1);
      await first.reconcile(firstRetry.add({ minutes: 20 }), 1);
      expect(await read(first.orderId)).toEqual([
        { payment_state: "paid", fulfillment_state: "fulfilled" },
      ]);
    });

    test("only the Pay screen for the current ended attempt can admit and record consent", async () => {
      const payment = await integration(
        database!,
        2_000,
        undefined,
        requestedInvoice
      );
      const pending = {
        status: "pending",
        statusUrl: `/en-US/reservation/status/${payment.orderId}`,
      };

      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      expect(await payment.pay()).toEqual(pending);
      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      expect(await payment.pay()).toEqual(pending);
      expect(await payment.evidenceCount()).toBe(2);
      expect(payment.providerOrders).toHaveLength(1);

      const firstRetry = await payment.retryApproval();
      payment.alignTwoPaySubmissions();
      const raced = await Promise.all([
        payment.pay(undefined, firstRetry),
        payment.pay(undefined, firstRetry),
      ]);
      expect(raced.map(({ status }) => status).sort()).toEqual([
        "hosted",
        "pending",
      ]);
      expect(payment.providerOrders).toHaveLength(2);
      expect(await payment.evidenceCount()).toBe(4);

      await payment.notify("failure", 1);
      payment.confirmProviderOrderEnded();
      expect(await payment.pay(undefined, firstRetry)).toEqual(pending);
      expect(await payment.pay()).toEqual(pending);
      expect(await payment.evidenceCount()).toBe(4);
      expect(payment.providerOrders).toHaveLength(2);

      const secondRetry = await payment.retryApproval();
      expect(secondRetry).not.toEqual(firstRetry);
      expect(await payment.pay(undefined, secondRetry)).toMatchObject({
        status: "hosted",
      });
      expect(await payment.evidenceCount()).toBe(6);
      expect(payment.providerOrders).toHaveLength(3);
      await payment.notify("failure", 2);
    });

    test("retries only the failed internal invoice copy after confirming the purchase", async () => {
      const db = database!;
      const payment = await integration(
        db,
        115_000,
        undefined,
        requestedInvoice
      );
      payment.rejectInternalInvoice();
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      const read = () =>
        db.pool
          .query(
            `select o.fulfillment_state, a.id as attempt_id, i.id as invoice_id,
                d.audience, d.state, d.attempt_count
         from orders o join payment_attempts a on a.order_id = o.id
         join invoices i on i.payment_attempt_id = a.id
         join invoice_email_deliveries d on d.invoice_id = i.id
         where o.id = $1 order by d.audience`,
            [payment.orderId]
          )
          .then(({ rows }) => rows);
      const failed = await read();
      expect(failed).toMatchObject([
        {
          fulfillment_state: "awaiting_delivery",
          audience: "customer",
          state: "accepted",
          attempt_count: 1,
        },
        {
          fulfillment_state: "awaiting_delivery",
          audience: "internal",
          state: "failed",
          attempt_count: 1,
        },
      ]);
      expect(payment.mail).toHaveLength(1);
      const later = Temporal.Now.instant().add({ minutes: 10 });
      await payment.reconcile(later);
      await payment.reconcile(later);
      expect(await read()).toEqual([
        { ...failed[0], fulfillment_state: "fulfilled" },
        {
          ...failed[1],
          fulfillment_state: "fulfilled",
          state: "accepted",
          attempt_count: 2,
        },
      ]);
      expect(payment.attemptedKeys).toEqual([
        `entry-pack-purchase:${payment.orderId}`,
      ]);
      expect(payment.deliveryAttempts).toHaveLength(3);
      expect(payment.providerOrders).toEqual([]);
    });

    test.each([2_000, 115_000])(
      "requires a fresh quote on the exclusive Prague end date for voucher value %i",
      async (voucherValue) => {
        const db = database!;
        const payment = await integration(
          db,
          voucherValue,
          Temporal.Instant.from("2026-11-19T12:00:00Z")
        );

        await expect(
          payment.pay(Temporal.Instant.from("2027-01-18T23:00:00Z"))
        ).rejects.toMatchObject({
          _tag: "EntryPackPurchaseError",
          reason: "quote-expired",
        });
        expect(payment.providerOrders).toEqual([]);
        const attempts = await db.pool.query(
          "select id from payment_attempts where order_id = $1",
          [payment.orderId]
        );
        expect(attempts.rows).toEqual([]);
      }
    );

    test.each([2_000, 115_000])(
      "refuses locked admission when Prague midnight crosses after Pay for voucher value %i",
      async (voucherValue) => {
        const db = database!;
        const payment = await integration(
          db,
          voucherValue,
          Temporal.Instant.from("2026-11-19T12:00:00Z")
        );
        payment.advanceDuringPay();
        await expect(
          payment.pay(Temporal.Instant.from("2027-01-18T22:59:59Z"))
        ).rejects.toMatchObject({
          _tag: "PaymentLifecycleStateError",
          message: "The Entry pack quote expired. Request a new quote.",
        });
        const attempts = await db.pool.query(
          "select id from payment_attempts where order_id = $1",
          [payment.orderId]
        );
        expect(attempts.rows).toEqual([]);
        expect(payment.providerOrders).toEqual([]);
      }
    );

    test("admits buyer voucher, releases it on terminal failure and redeems it on verified late capture", async () => {
      const db = database!;
      const payment = await integration(db, 2_000);
      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      expect(await payment.pay()).toMatchObject({ status: "pending" });
      expect(payment.providerOrders).toHaveLength(1);
      const claims = () =>
        db.pool.query(
          `select vr.state, vr.dotypos_customer_id, pa.workspace_reservation_id
         from voucher_redemptions vr join payment_attempts pa on pa.id = vr.payment_attempt_id
         where pa.order_id = $1`,
          [payment.orderId]
        );
      expect((await claims()).rows).toEqual([
        {
          state: "reserved",
          dotypos_customer_id: dotyposCustomerId,
          workspace_reservation_id: null,
        },
      ]);
      await payment.notify("failure");
      expect((await claims()).rows[0]?.state).toBe("released");
      expect(
        (
          await db.pool.query(
            "select status from pass_purchases where id = $1",
            [payment.orderId]
          )
        ).rows
      ).toEqual([{ status: "void" }]);
      await payment.notify("success");
      await payment.notify("success");
      expect((await claims()).rows[0]?.state).toBe("redeemed");
      expect(
        (
          await db.pool.query(
            "select status from pass_purchases where id = $1",
            [payment.orderId]
          )
        ).rows
      ).toEqual([{ status: "active" }]);
      expect(payment.mail).toHaveLength(1);
      expect(payment.mail[0]).toMatchObject({
        to: { email },
        idempotencyKey: `entry-pack-purchase:${payment.orderId}`,
      });
    });

    test.each([2_000, 115_000])(
      "retries confirmation through reconciliation with frozen buyer accounting for voucher value %i",
      async (voucherValue) => {
        const db = database!;
        const internal = voucherValue === 115_000;
        const address = {
          line1: "Synthetic 8",
          city: "Praha",
          postalCode: "11000",
          country: "CZ",
        };
        const billing: ReservationBillingSelection = internal
          ? {
              purpose: "business",
              invoice: "required",
              buyer: {
                kind: "business",
                legalName: "Fixture Buyer Company",
                companyId: companyRegistrationIdSchema.make("12345678"),
                address,
              },
            }
          : { purpose: "personal", invoice: "requested", address };
        const frozenBuyer =
          billing.purpose === "business"
            ? billing.buyer
            : { kind: "person", legalName: "Fixture Buyer", address };
        const payment = await integration(db, voucherValue, undefined, billing);
        payment.rejectNextEmail();
        expect(await payment.pay()).toMatchObject({
          status: internal ? "paid" : "hosted",
        });
        payment.changeBuyerName("Changed Buyer Profile");
        if (!internal)
          await expect(payment.notify("success")).rejects.toBeDefined();
        const progress = () =>
          db.pool.query(
            "select payment_state, fulfillment_state from orders where id = $1",
            [payment.orderId]
          );
        expect((await progress()).rows).toEqual([
          { payment_state: "paid", fulfillment_state: "not_started" },
        ]);
        const later = Temporal.Now.instant().add({ minutes: 10 });
        await payment.reconcile(later);
        await payment.reconcile(later);
        expect((await progress()).rows).toEqual([
          { payment_state: "paid", fulfillment_state: "fulfilled" },
        ]);
        expect(payment.attemptedKeys).toEqual([
          `entry-pack-purchase:${payment.orderId}`,
          `entry-pack-purchase:${payment.orderId}`,
        ]);
        expect(payment.mail).toHaveLength(1);
        expect(payment.providerOrders).toHaveLength(internal ? 0 : 1);
        const accountingRows = await db.pool.query<{
          attempt_id: string;
          invoice_id: string;
        }>(
          `select pa.id as attempt_id, i.id as invoice_id
           from payment_attempts pa
           left join invoices i on i.payment_attempt_id = pa.id
           where pa.order_id = $1`,
          [payment.orderId]
        );
        expect(accountingRows.rows).toHaveLength(1);
        const row = accountingRows.rows[0]!;
        expect(payment.invoiceDeliveries).toEqual(new Set([row.invoice_id]));
        const { snapshot, invoice } = await payment.readAccounting(
          row.attempt_id,
          row.invoice_id
        );
        expect(snapshot).toMatchObject({
          orderId: payment.orderId,
          dotyposCustomerId,
          buyer: frozenBuyer,
          billing,
          delivery: { email },
          quote: { discountedSubtotal: { value: 115_000 - voucherValue } },
        });
        expect(invoice).toMatchObject({
          workspaceReservationId: null,
          paymentAttemptId: row.attempt_id,
          document: {
            documentKind: "pass-purchase",
            orderId: payment.orderId,
            buyer: frozenBuyer,
            delivery: { email },
          },
        });
        expect(
          invoice && getInvoicePresentation(invoice.document).lines
        ).toHaveLength(2);
      }
    );

    test.each([false, true])(
      "reconciles abandoned Nexi holds and releases claims (attached page %p)",
      async (attached) => {
        const db = database!;
        const payment = await integration(db, 2_000);
        if (attached) {
          expect(await payment.pay()).toMatchObject({ status: "hosted" });
          payment.abandonProviderOrder();
        } else {
          payment.rejectNextCreation();
          await expect(payment.pay()).rejects.toBeDefined();
        }
        const later = Temporal.Now.instant().add({ minutes: 31 });
        const read = () =>
          db.pool.query(
            `select p.status, pa.state, vr.state as claim
           from pass_purchases p join payment_attempts pa on pa.order_id = p.id
           join voucher_redemptions vr on vr.payment_attempt_id = pa.id
           where p.id = $1 order by pa.created_at, pa.id`,
            [payment.orderId]
          );
        if (attached)
          expect(await payment.pay(later)).toMatchObject({ status: "pending" });
        expect((await read()).rows).toEqual([
          {
            status: "pending_payment",
            state: attached ? "pending" : "created",
            claim: "reserved",
          },
        ]);
        await payment.reconcile(later);
        expect((await read()).rows).toEqual([
          {
            status: "void",
            state: attached ? "expired" : "failed",
            claim: "released",
          },
        ]);
        expect(await payment.pay(later)).toMatchObject({ status: "pending" });
        expect(payment.providerOrders).toHaveLength(1);
        if (attached) {
          payment.confirmProviderOrderEnded();
          expect(
            await payment.pay(later, await payment.retryApproval())
          ).toMatchObject({ status: "hosted" });
          expect(payment.providerOrders).toHaveLength(2);
          expect((await read()).rows.map(({ claim }) => claim)).toEqual([
            "released",
            "reserved",
          ]);
        }
      }
    );

    test("records a superseded capture for refund without replacing the current attempt", async () => {
      const db = database!;
      const payment = await integration(db, 2_000);
      await payment.pay();
      await payment.notify("failure");
      payment.confirmProviderOrderEnded();
      const approval = await payment.retryApproval();
      await payment.pay(undefined, approval);
      expect(payment.providerOrders).toHaveLength(2);
      await payment.notify("success");
      expect(
        (
          await db.pool.query(
            "select status from pass_purchases where id = $1",
            [payment.orderId]
          )
        ).rows
      ).toEqual([{ status: "pending_payment" }]);
      const attempts = await db.pool.query(
        "select state, refund_state from payment_attempts where order_id = $1 order by created_at, id",
        [payment.orderId]
      );
      expect(attempts.rows).toEqual([
        { state: "paid", refund_state: "required" },
        { state: "pending", refund_state: "not_required" },
      ]);
      expect(payment.mail).toHaveLength(0);
    });

    test("uses an internal paid attempt for a fully covered pack", async () => {
      const db = database!;
      const payment = await integration(db, 115_000);
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      expect(payment.providerOrders).toEqual([]);
      expect(payment.mail).toHaveLength(1);
      expect(payment.invitations).toHaveLength(0);
      expect(
        (
          await db.pool.query(
            `select pa.provider, pa.amount_value, vr.state from payment_attempts pa
         join voucher_redemptions vr on vr.payment_attempt_id = pa.id where pa.order_id = $1`,
            [payment.orderId]
          )
        ).rows
      ).toEqual([{ provider: "internal", amount_value: 0, state: "redeemed" }]);
    });

    test("fulfills simultaneous gifts when the pool has one lock permit", async () => {
      const db = database!;
      const recipients = [
        "concurrent-gift-first",
        "concurrent-gift-second",
      ].map(testEmailAddress);
      const purchases = await Promise.all(
        recipients.map((holderEmail) =>
          integration(db, 115_000, undefined, undefined, undefined, holderEmail)
        )
      );
      const signal = AbortSignal.timeout(5_000);
      const paid = await Promise.all(
        purchases.map((purchase) => purchase.pay(undefined, undefined, signal))
      );
      expect(paid.map(({ status }) => status)).toEqual(["paid", "paid"]);
      for (const [index, purchase] of purchases.entries()) {
        expect(purchase.invitations).toHaveLength(1);
        expect(purchase.invitations[0]?.to).toEqual({
          email: recipients[index],
        });
        expect(purchase.mail).toHaveLength(1);
        expect(purchase.mail[0]?.to).toEqual({ email });
      }
    });

    test.each([2_000, 115_000])(
      "issues a holder-only gift after paid settlement with voucher value %i",
      async (voucherValue) => {
        const db = database!;
        const internal = voucherValue === 115_000;
        const holderEmail = testEmailAddress(
          internal ? "internal-gift-recipient" : "provider-gift-recipient"
        );
        const existingHolder = internal
          ? undefined
          : customerAccountIdSchema.make(crypto.randomUUID());
        if (existingHolder) {
          await db.pool.query(
            "insert into customer_accounts (id, dotypos_customer_id) values ($1, $2)",
            [existingHolder, "synthetic-linked-gift-holder"]
          );
          await db.pool.query(
            'insert into auth."user" (id, name, email, email_verified) values ($1, $2, $3, true)',
            [existingHolder, "", holderEmail]
          );
        }
        const payment = await integration(
          db,
          voucherValue,
          undefined,
          undefined,
          undefined,
          holderEmail
        );
        const {
          orderId,
          initialPurchase: { holderAccountId, validFrom },
        } = payment;
        if (existingHolder) expect(holderAccountId).toBe(existingHolder);
        const readGift = () =>
          Effect.runPromise(
            readEntryPackGiftState(orderId).pipe(Effect.provide(db.layer))
          );
        const markClaimed = (
          id: typeof holderAccountId,
          at: Temporal.Instant
        ) =>
          Effect.runPromise(
            claimEntryPackGifts(id, at).pipe(Effect.provide(db.layer))
          );
        const quote = (id: typeof holderAccountId) =>
          Effect.runPromise(
            loadEntryPackRedemption(db.db, {
              passId: orderId,
              holderAccountId: id,
              date: validFrom,
            })
          );
        const resend = (id: typeof holderAccountId, at: Temporal.Instant) =>
          Effect.runPromise(
            queueEntryPackGiftResend(orderId, id).pipe(
              WorkspaceLockSections.passPurchaseFulfillment(orderId),
              Effect.provide(
                Layer.merge(
                  db.layer,
                  WorkspaceDatabaseAdvisoryLock.makeLayer(db.databasePool)
                )
              ),
              atInstant(at)
            )
          );
        const resolve = (secret: string, at: Temporal.Instant) =>
          Effect.runPromise(
            resolveEntryPackGiftInvitation(secret).pipe(
              Effect.provide(Layer.merge(db.layer, SealedStateKeys.Default)),
              atInstant(at)
            )
          );
        const extractContext = (message: EmailMessage) => {
          const href = message.html?.match(
            /href="([^"]*\/auth\/sign-in\?gift-sign-in=1#[^"]+)"/
          )?.[1];
          if (!href)
            throw new Error("Gift email did not link to site sign-in.");
          const link = new URL(href);
          expect(link.search).toBe("?gift-sign-in=1");
          const context = new URLSearchParams(link.hash.slice(1)).get("gift");
          if (!context) throw new Error("The sign-in link lacks gift context.");
          return context;
        };

        const beforePayment = Temporal.Now.instant();
        expect(await readGift()).toEqual({
          invitation: "not_sent",
          claimed: false,
          canResend: false,
        });
        expect(await resend(accountId, beforePayment)).toBe(false);
        expect(payment.invitations).toHaveLength(0);
        if (!internal) payment.rejectNextInvitation();
        expect(await payment.pay()).toMatchObject({
          status: internal ? "paid" : "hosted",
        });
        if (!internal) {
          expect(payment.invitations).toHaveLength(0);
          await payment.notify("success");
          await payment.notify("success");
        }
        expect(payment.mail).toHaveLength(1);
        expect(payment.invitations).toHaveLength(1);
        expect(await readGift()).toMatchObject({
          invitation: internal ? "sent" : "pending",
          claimed: false,
        });
        const first = payment.invitations[0]!;
        expect(first.to).toEqual({ email: holderEmail });
        expect(first.sensitiveContent).toBe(true);
        expect(first.html?.includes("Claim your pass")).toBe(true);
        expect(first.html?.includes("coffee when you book")).toBe(true);
        expect(first.html?.includes("invoice")).toBe(false);
        expect(payment.mail[0]?.html?.includes("emailed an invitation")).toBe(
          internal
        );
        const secret = extractContext(first);
        const later = Temporal.Now.instant().add({ minutes: 20 });
        if (!internal) {
          await payment.reconcile(later);
          await payment.reconcile(later);
          expect(payment.invitations).toHaveLength(2);
          expect(payment.invitations[1]?.idempotencyKey).toBe(
            first.idempotencyKey
          );
          expect(payment.invitations[1]?.html === first.html).toBe(true);
          expect(payment.mail).toHaveLength(1);
        }
        expect(await readGift()).toMatchObject({
          invitation: "sent",
          claimed: false,
        });
        expect(await resolve(secret, later)).toEqual({
          orderId,
          email: holderEmail,
          holderAccountId,
        });
        expect(
          await resolve(`${secret.slice(0, -2)}!!`, later)
        ).toBeUndefined();
        expect(
          await resolve(secret, later.add({ hours: 7 * 24 }))
        ).toBeUndefined();
        expect(await resend(holderAccountId, later)).toBe(false);
        await expect(quote(holderAccountId)).rejects.toBeDefined();
        if (internal) await markClaimed(holderAccountId, later);
        expect((await readGift()).claimed).toBe(false);

        if (internal) {
          const resendSignal = AbortSignal.timeout(5_000);
          expect(await payment.resendAsBuyer(later, resendSignal)).toBe(
            "queued"
          );
          expect(await payment.resendAsBuyer(later, resendSignal)).toBe(
            "unavailable"
          );
          expect(await resolve(secret, later)).toBeUndefined();
          await payment.reconcile(later.add({ minutes: 1 }));
          expect(payment.invitations).toHaveLength(2);
          expect(payment.invitations[1]?.idempotencyKey).not.toBe(
            first.idempotencyKey
          );
        }
        const currentSecret = extractContext(payment.invitations.at(-1)!);
        await db.pool.query(
          'update auth."user" set email_verified = true where id = $1',
          [holderAccountId]
        );
        await markClaimed(holderAccountId, beforePayment);
        await markClaimed(accountId, later);
        expect((await readGift()).claimed).toBe(false);
        if (!internal) {
          await db.pool.query(
            "update payment_attempts set refund_state = 'required' where order_id = $1",
            [orderId]
          );
          expect(await resolve(currentSecret, later)).toBeUndefined();
          await markClaimed(holderAccountId, later);
          expect((await readGift()).claimed).toBe(false);
          await db.pool.query(
            "update payment_attempts set refund_state = 'not_required' where order_id = $1",
            [orderId]
          );
        }
        await markClaimed(holderAccountId, later.add({ minutes: 2 }));
        await markClaimed(holderAccountId, later.add({ minutes: 3 }));
        expect(await readGift()).toMatchObject({
          claimed: true,
          canResend: false,
        });
        expect(
          await resolve(currentSecret, later.add({ minutes: 4 }))
        ).toBeUndefined();
        expect(await resend(accountId, later.add({ hours: 1 }))).toBe(false);
        await expect(quote(accountId)).rejects.toBeDefined();
        expect(await quote(holderAccountId)).toMatchObject({
          passId: orderId,
          holderAccountId,
        });
        if (!internal) {
          await db.pool.query(
            "update payment_attempts set refund_state = 'required' where order_id = $1",
            [orderId]
          );
          await expect(quote(holderAccountId)).rejects.toBeDefined();
        }
      }
    );

    test("allows the paid buyer confirmation when holder deletion blocks the invitation", async () => {
      const db = database!;
      const payment = await integration(
        db,
        115_000,
        undefined,
        undefined,
        undefined,
        testEmailAddress("deleting-gift-recipient")
      );
      await db.pool.query(
        'update auth."user" set deletion_requested_at = now() where id = $1',
        [payment.initialPurchase.holderAccountId]
      );
      expect(await payment.pay()).toMatchObject({ status: "paid" });
      expect(payment.invitations).toHaveLength(0);
      expect(payment.mail).toHaveLength(1);
    });

    test("preserves bookability of a paid gift from before gift activation tracking", async () => {
      const db = database!;
      const payment = await integration(
        db,
        115_000,
        undefined,
        undefined,
        undefined,
        testEmailAddress("legacy-gift-recipient")
      );
      await payment.pay();
      const {
        orderId,
        initialPurchase: { holderAccountId, validFrom },
      } = payment;
      await db.pool.query(
        "delete from entry_pack_gift_invitations where order_id = $1",
        [orderId]
      );
      await db.pool.query(
        "update pass_purchases set gift_issued_at = null where id = $1",
        [orderId]
      );

      expect(
        await Effect.runPromise(
          readEntryPackGiftState(orderId).pipe(Effect.provide(db.layer))
        )
      ).toEqual({ invitation: "not_sent", claimed: false, canResend: true });
      expect(
        await Effect.runPromise(
          loadEntryPackRedemption(db.db, {
            passId: orderId,
            holderAccountId,
            date: validFrom,
          })
        )
      ).toMatchObject({ passId: orderId, holderAccountId });
    });

    test("does not replay an uncertain invitation with changed content", async () => {
      const db = database!;
      const payment = await integration(
        db,
        115_000,
        undefined,
        undefined,
        undefined,
        testEmailAddress("fingerprint-gift-recipient")
      );
      payment.rejectNextInvitation();
      await payment.pay();
      const { orderId } = payment;
      await db.pool.query(
        "update entry_pack_gift_invitations set delivery_fingerprint = $2 where order_id = $1",
        [orderId, "previous-template-fingerprint"]
      );
      const later = Temporal.Now.instant().add({ minutes: 20 });
      await payment.reconcile(later);
      expect(payment.invitations).toHaveLength(1);
      expect(payment.mail).toHaveLength(1);
      expect(
        await Effect.runPromise(
          readEntryPackGiftState(orderId).pipe(
            Effect.provide(db.layer),
            atInstant(later)
          )
        )
      ).toEqual({ invitation: "failed", claimed: false, canResend: true });
    });

    test("creates one pending order with an empty entry and evidence ledger", async () => {
      const db = database!;
      const orderId = orderIdSchema.make(crypto.randomUUID());
      const holderEmail = testEmailAddress("pass-holder");
      const begin = beginEntryPackPurchase({
        orderId,
        product: { kind: "entry-pack", size: 10, tier: "reserved-desk" },
        holderEmail,
        locale: "en-US",
      }).pipe(Effect.provide(Layer.merge(db.layer, purchaseServices)));

      const first = await Effect.runPromise(begin);
      const retry = await Effect.runPromise(begin);
      expect(retry).toEqual(first);
      expect(first).toMatchObject({
        id: orderId,
        buyerAccountId: accountId,
        status: "pending_payment",
        entryCount: 10,
      });
      expect(first.holderAccountId).not.toBe(accountId);
      const holder = await db.pool.query(
        'select login.email, login.email_verified, account.dotypos_customer_id from auth."user" login join customer_accounts account using (id) where login.id = $1',
        [first.holderAccountId]
      );
      expect(holder.rows).toEqual([
        {
          email: holderEmail,
          email_verified: false,
          dotypos_customer_id: null,
        },
      ]);
      const { rows } = await db.pool.query(
        "select kind, payment_state from orders where id = $1",
        [orderId]
      );
      expect(rows).toEqual([
        { kind: "pass-purchase", payment_state: "not_started" },
      ]);
      expect(
        (
          await db.pool.query(
            "select 1 from pass_entry_claims where pass_id = $1",
            [orderId]
          )
        ).rowCount
      ).toBe(0);

      expect(
        (
          await db.pool.query(
            "select 1 from legal_evidence_events where order_id = $1",
            [orderId]
          )
        ).rowCount
      ).toBe(0);
    });

    test("admission records the current terms and early-start consent", async () => {
      const db = database!;
      const payment = await integration(db, 2_000);
      await expect(
        payment.pay(undefined, { accepted: false })
      ).rejects.toMatchObject({
        reason: "consent-required",
      });
      await expect(
        payment.pay(undefined, { acceptedDocuments: [] })
      ).rejects.toMatchObject({
        reason: "terms-changed",
      });
      expect(await payment.evidenceCount()).toBe(0);
      expect(payment.providerOrders).toHaveLength(0);
      expect(await payment.pay()).toMatchObject({ status: "hosted" });
      const orderId = payment.orderId;
      const evidence = await db.pool.query(
        "select document_key, workspace_reservation_id, acknowledgements from legal_evidence_events where order_id = $1 order by document_key",
        [orderId]
      );
      expect(evidence.rows).toEqual([
        {
          document_key: "operatingRules",
          workspace_reservation_id: null,
          acknowledgements: {},
        },
        {
          document_key: "termsAndConditions",
          workspace_reservation_id: null,
          acknowledgements: {
            earlyPerformanceConsent: true,
            entryPackEarlyStartRequested: true,
          },
        },
      ]);
    });

    test("reuses one unverified holder across concurrent purchases with the same login email", async () => {
      const db = database!;
      const holderEmail = testEmailAddress("shared-pack-holder");
      const begin = (email: string) =>
        Effect.runPromise(
          beginEntryPackPurchase({
            orderId: orderIdSchema.make(crypto.randomUUID()),
            product: { kind: "entry-pack", size: 5, tier: "open-space" },
            locale: "en-US",
            holderEmail: email,
          }).pipe(Effect.provide(Layer.merge(db.layer, purchaseServices)))
        );
      const [first, second] = await Promise.all([
        begin(holderEmail),
        begin(holderEmail.toUpperCase()),
      ]);
      expect(second.holderAccountId).toBe(first.holderAccountId);
      const holder = await db.pool.query(
        'select email_verified from auth."user" where email = $1',
        [holderEmail]
      );
      expect(holder.rows).toEqual([{ email_verified: false }]);
    });

    test("voids unpaid packs and activates verified late payments just once", async () => {
      const db = database!;
      const orderId = orderIdSchema.make(crypto.randomUUID());
      const purchase = await Effect.runPromise(
        beginEntryPackPurchase({
          orderId,
          product: { kind: "entry-pack", size: 5, tier: "open-space" },
          locale: "en-US",
        }).pipe(Effect.provide(Layer.merge(db.layer, purchaseServices)))
      );
      expect(purchase.holderAccountId).toBe(accountId);
      const settle = settlePassPurchase(orderId).pipe(Effect.provide(db.layer));

      await db.pool.query(
        "update orders set payment_state = 'expired' where id = $1",
        [orderId]
      );
      await Effect.runPromise(settle);
      expect(
        (
          await db.pool.query(
            "select status from pass_purchases where id = $1",
            [orderId]
          )
        ).rows
      ).toEqual([{ status: "void" }]);

      await db.pool.query(
        "update orders set payment_state = 'paid', paid_at = now() where id = $1",
        [orderId]
      );
      expect(await Effect.runPromise(settle)).toMatchObject({
        id: orderId,
        status: "active",
      });
      expect(await Effect.runPromise(settle)).toBeUndefined();

      await db.pool.query(
        "update pass_purchases set status = 'withdrawn' where id = $1",
        [orderId]
      );
      expect(await Effect.runPromise(settle)).toBeUndefined();
      expect(
        (
          await db.pool.query(
            "select status from pass_purchases where id = $1",
            [orderId]
          )
        ).rows
      ).toEqual([{ status: "withdrawn" }]);
    });
  }
);
