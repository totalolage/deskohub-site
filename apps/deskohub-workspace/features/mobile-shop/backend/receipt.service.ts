import "server-only";

import { DotyposService } from "@deskohub/dotypos";
import { EmailConfigTag, EmailServiceTag } from "@deskohub/email";
import { Context, Effect, Layer } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { MobileShopPurchaseId } from "../contracts";
import {
  type MobileShopFulfillmentRecord,
  MobileShopPurchaseLifecycleRepository,
} from "./purchase-lifecycle.repository";

export interface IMobileShopReceiptService {
  readonly deliverPaidReceipt: (input: {
    readonly purchaseId: MobileShopPurchaseId;
  }) => Effect.Effect<void>;
}

export class MobileShopReceiptService extends Context.Service<
  MobileShopReceiptService,
  IMobileShopReceiptService
>()("@deskohub-workspace/mobile-shop/MobileShopReceiptService") {
  static Live = Layer.effect(
    this,
    Effect.gen(function* () {
      const purchases = yield* MobileShopPurchaseLifecycleRepository;
      const dotypos = yield* DotyposService;
      const email = yield* EmailServiceTag;
      const emailConfig = yield* EmailConfigTag;

      return {
        deliverPaidReceipt: Effect.fn(
          "MobileShopReceiptService.deliverPaidReceipt"
        )(
          function* (input) {
            const purchase = yield* purchases
              .claimReceipt(input.purchaseId)
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logError("Mobile shop receipt claim failed", {
                    purchaseId: input.purchaseId,
                    cause,
                  })
                ),
                Effect.orElseSucceed(() => null)
              );
            if (!purchase) return;

            const customer = yield* dotypos
              .getCustomer(purchase.order.dotyposCustomerId)
              .pipe(
                Effect.tapError((cause) =>
                  failReceipt({
                    purchaseId: input.purchaseId,
                    failureCode: "receipt_customer_unavailable",
                    cause,
                    purchases,
                  })
                ),
                Effect.orElseSucceed(() => null)
              );
            const recipient = customer?.email?.trim();
            if (!recipient) {
              yield* failReceipt({
                purchaseId: input.purchaseId,
                failureCode: "receipt_recipient_unavailable",
                purchases,
              });
              return;
            }

            const result = yield* email
              .send({
                from: emailConfig.defaultFrom,
                to: { email: recipient },
                subject:
                  purchase.order.locale === "cs-CZ"
                    ? `Potvrzení nákupu ${purchase.order.publicReference}`
                    : `Purchase receipt ${purchase.order.publicReference}`,
                text: renderReceipt(purchase),
                replyTo: { email: workspaceSiteConstants.contact.infoEmail },
                tags: ["mobile-shop-receipt"],
                metadata: {
                  workspaceReservationId: purchase.order.id,
                  purchaseId: purchase.order.id,
                },
              })
              .pipe(
                Effect.tapError((cause) =>
                  failReceipt({
                    purchaseId: input.purchaseId,
                    failureCode: "receipt_delivery_failed",
                    cause,
                    purchases,
                  })
                ),
                Effect.orElseSucceed(() => null)
              );
            if (!result) return;

            yield* purchases
              .markReceiptSent({
                purchaseId: input.purchaseId,
                providerMessageId: result.id,
                sentAt: Temporal.Now.instant(),
              })
              .pipe(
                Effect.tapError((cause) =>
                  Effect.logFatal(
                    "Mobile shop receipt was accepted but its durable marker failed",
                    { purchaseId: input.purchaseId, cause }
                  )
                ),
                Effect.ignore
              );
          },
          (effect, input) =>
            effect.pipe(
              Effect.annotateLogs({ purchaseId: input.purchaseId }),
              Effect.scoped
            )
        ),
      } satisfies IMobileShopReceiptService;
    })
  );
}

const failReceipt = (input: {
  readonly purchaseId: MobileShopPurchaseId;
  readonly failureCode: string;
  readonly cause?: unknown;
  readonly purchases: typeof MobileShopPurchaseLifecycleRepository.Service;
}) =>
  input.purchases
    .markReceiptFailed({
      purchaseId: input.purchaseId,
      failureCode: input.failureCode,
    })
    .pipe(
      Effect.tapError((cause) =>
        Effect.logFatal("Mobile shop receipt failure marker failed", {
          purchaseId: input.purchaseId,
          failureCode: input.failureCode,
          cause,
        })
      ),
      Effect.ignore,
      Effect.andThen(
        Effect.logError("Mobile shop receipt delivery failed", {
          purchaseId: input.purchaseId,
          failureCode: input.failureCode,
          cause: input.cause,
        })
      )
    );

const renderReceipt = (purchase: MobileShopFulfillmentRecord) => {
  const locale = purchase.order.locale;
  const currency = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: purchase.order.currency,
  });
  const amount = (value: number) =>
    currency.format(value / 10 ** purchase.order.totalExponent);
  const lines = purchase.items.map(
    (item) =>
      `${item.quantity} × ${item.displayName} — ${amount(item.lineTotalValue)}`
  );
  const seller = [
    workspaceSiteConstants.brand.legalName,
    `${locale === "cs-CZ" ? "IČO" : "Company ID"}: ${workspaceSiteConstants.company.identificationNumber}`,
    `${workspaceSiteConstants.location.address.street}, ${workspaceSiteConstants.location.address.postalCode} ${workspaceSiteConstants.location.address.city}`,
    getSellerTaxNote(purchase),
  ];

  return locale === "cs-CZ"
    ? [
        `Potvrzení nákupu ${purchase.order.publicReference}`,
        "",
        ...lines,
        "",
        `Celkem: ${amount(purchase.order.totalValue)}`,
        "",
        ...seller,
        "",
        `Podpora: ${workspaceSiteConstants.contact.infoEmail}`,
      ].join("\n")
    : [
        `Purchase receipt ${purchase.order.publicReference}`,
        "",
        ...lines,
        "",
        `Total: ${amount(purchase.order.totalValue)}`,
        "",
        ...seller,
        "",
        `Support: ${workspaceSiteConstants.contact.infoEmail}`,
      ].join("\n");
};

const getSellerTaxNote = (purchase: MobileShopFulfillmentRecord) => {
  if (purchase.order.taxRegime.kind === "vat-payer") {
    return `VAT ID: ${purchase.order.taxRegime.vatId}`;
  }
  return purchase.order.locale === "cs-CZ"
    ? "Prodávající není plátcem DPH."
    : "The seller is not a VAT payer.";
};
