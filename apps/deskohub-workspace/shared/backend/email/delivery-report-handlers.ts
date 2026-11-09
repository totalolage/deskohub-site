import { Layer } from "effect";
import {
  customerAccessDeliveryReports,
  ReservationFulfillment,
} from "@/features/checkout/backend/fulfillment";
import { campaignDeliveryReports } from "@/features/email-campaigns/backend/campaign-delivery-reports";
import { CampaignDeliveryStatusService } from "@/features/email-campaigns/backend/campaign-delivery-status.service";
import type { DeliveryReportHandler } from "./delivery-reports";

/** The handlers of every email kind whose delivery reports Workspace applies. */
export const deliveryReportHandlers: readonly DeliveryReportHandler<
  ReservationFulfillment | CampaignDeliveryStatusService
>[] = [customerAccessDeliveryReports, campaignDeliveryReports];

/** The services the delivery-report handlers need. */
export const DeliveryReportHandlersLive = Layer.mergeAll(
  ReservationFulfillment.Live,
  CampaignDeliveryStatusService.Live
);
