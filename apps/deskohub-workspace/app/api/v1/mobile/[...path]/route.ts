import { StandaloneEmailServiceLayer } from "@deskohub/email/backend/standalone-email-service";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { CustomerAccountService } from "@/features/account/backend/customer-account.service";
import {
  MobileShopCatalogPolicy,
  MobileShopCatalogSource,
} from "@/features/mobile-shop/backend/catalog-source.service";
import { MobileShopCustomerAccess } from "@/features/mobile-shop/backend/customer-access.service";
import { MobileShopPaidFulfillmentService } from "@/features/mobile-shop/backend/paid-fulfillment.service";
import { MobileShopPaymentService } from "@/features/mobile-shop/backend/payment.service";
import { MobileShopPurchaseRepository } from "@/features/mobile-shop/backend/purchase.repository";
import { MobileShopPurchaseLifecycleRepository } from "@/features/mobile-shop/backend/purchase-lifecycle.repository";
import { MobileShopReceiptService } from "@/features/mobile-shop/backend/receipt.service";
import { MobileShopStockFulfillment } from "@/features/mobile-shop/backend/stock-fulfillment.service";
import {
  MobileShopEntitlementService,
  MobileShopReservationSource,
} from "@/features/mobile-shop/eligibility";
import { handleMobileShopApiRequest } from "@/features/mobile-shop/mobile-api.server";
import { MobileShopService } from "@/features/mobile-shop/mobile-shop.service";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { EmailConfigLayer } from "@/shared/backend/config/email.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import {
  defineWorkspaceRoute,
  WorkspaceRouteFailure,
} from "@/shared/backend/workspace-route";

const databaseAndDotyposLive = Layer.mergeAll(
  WorkspaceDatabaseLive,
  DotyposServiceLive
);
const accountServiceLive = CustomerAccountService.Live.pipe(
  Layer.provide(databaseAndDotyposLive)
);
const customerAccessLive = MobileShopCustomerAccess.Live.pipe(
  Layer.provide(accountServiceLive)
);
const reservationSourceLive = MobileShopReservationSource.Dotypos.pipe(
  Layer.provide(DotyposServiceLive)
);
const entitlementLive = MobileShopEntitlementService.Live.pipe(
  Layer.provide(reservationSourceLive)
);
const catalogSourceLive = MobileShopCatalogSource.Dotypos.pipe(
  Layer.provide(DotyposServiceLive)
);
const purchaseRepositoryLive = MobileShopPurchaseRepository.Live.pipe(
  Layer.provide(WorkspaceDatabaseLive)
);
const purchaseLifecycleLive = MobileShopPurchaseLifecycleRepository.Live.pipe(
  Layer.provide(WorkspaceDatabaseLive)
);
const emailServiceLive = StandaloneEmailServiceLayer.pipe(
  Layer.provide(EmailConfigLayer)
);
const receiptLive = MobileShopReceiptService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      purchaseLifecycleLive,
      DotyposServiceLive,
      emailServiceLive,
      EmailConfigLayer
    )
  )
);
const stockLive = MobileShopStockFulfillment.Dotypos.pipe(
  Layer.provide(DotyposServiceLive)
);
const fulfillmentLive = MobileShopPaidFulfillmentService.Live.pipe(
  Layer.provide(Layer.mergeAll(purchaseLifecycleLive, receiptLive, stockLive))
);
const paymentLive = MobileShopPaymentService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      purchaseLifecycleLive,
      DotyposServiceLive,
      NexiServiceLive,
      PostHogEventServiceLive
    )
  )
);
const mobileShopLive = MobileShopService.Live.pipe(
  Layer.provide(
    Layer.mergeAll(
      customerAccessLive,
      entitlementLive,
      catalogSourceLive,
      MobileShopCatalogPolicy.DesktechubNonVat,
      purchaseRepositoryLive,
      paymentLive,
      fulfillmentLive
    )
  )
);

const handleMobileShop = (request: Request) =>
  handleMobileShopApiRequest(request).pipe(
    Effect.provide(mobileShopLive),
    Effect.mapError(
      WorkspaceRouteFailure.internal("Mobile shop configuration unavailable")
    )
  );

export const GET = defineWorkspaceRoute(
  {
    operation: "mobileShopApiRead",
    cancellation: "interrupt-on-disconnect",
  },
  handleMobileShop
);

export const OPTIONS = GET;

export const POST = defineWorkspaceRoute(
  {
    operation: "mobileShopApiMutation",
    cancellation: "continue-after-disconnect",
  },
  handleMobileShop
);
