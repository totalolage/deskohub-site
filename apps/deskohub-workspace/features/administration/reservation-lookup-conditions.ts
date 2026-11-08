import { DotyposReservationIdSchema } from "@deskohub/dotypos";
import {
  NexiCorrelationIdSchema,
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  NexiWebhookEventIdSchema,
} from "@deskohub/nexi";
import { type Column, eq, or, type SQL, sql } from "drizzle-orm";
import { Option, Schema } from "effect";
import {
  discountApplications,
  legalEvidenceEvents,
  paymentAttempts,
  webhookEvents,
  workspaceReservations,
} from "@/db/schema";
import {
  checkoutAttemptKeySchema,
  checkoutSessionKeySchema,
  paymentAttemptIdSchema,
  storedWebhookEventIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { legalEvidenceEventIdSchema } from "@/features/checkout/legal-evidence";
import { discountApplicationIdSchema } from "@/features/discounts/persistence-contracts";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const decodeCheckoutAttemptKey = Schema.decodeUnknownOption(
  checkoutAttemptKeySchema
);
const decodeCheckoutSessionKey = Schema.decodeUnknownOption(
  checkoutSessionKeySchema
);
const decodeNexiCorrelationId = Schema.decodeUnknownOption(
  NexiCorrelationIdSchema
);
const decodeDiscountApplicationId = Schema.decodeUnknownOption(
  discountApplicationIdSchema
);
const decodeDotyposReservationId = Schema.decodeUnknownOption(
  DotyposReservationIdSchema
);
const decodeLegalEvidenceEventId = Schema.decodeUnknownOption(
  legalEvidenceEventIdSchema
);
const decodeNexiOperationId = Schema.decodeUnknownOption(NexiOperationIdSchema);
const decodeNexiOrderId = Schema.decodeUnknownOption(NexiOrderIdSchema);
const decodeNexiWebhookEventId = Schema.decodeUnknownOption(
  NexiWebhookEventIdSchema
);
const decodePaymentAttemptId = Schema.decodeUnknownOption(
  paymentAttemptIdSchema
);
const decodeStoredWebhookEventId = Schema.decodeUnknownOption(
  storedWebhookEventIdSchema
);
const decodeWorkspaceReservationId = Schema.decodeUnknownOption(
  workspaceReservationIdSchema
);

/** Every record id an operator's lookup identifier can stand for. */
const getReservationLookupIds = (identifier: string) => ({
  checkoutAttemptKey: Option.getOrUndefined(
    decodeCheckoutAttemptKey(identifier)
  ),
  checkoutSessionKey: Option.getOrUndefined(
    decodeCheckoutSessionKey(identifier)
  ),
  correlationId: Option.getOrUndefined(decodeNexiCorrelationId(identifier)),
  discountApplicationId: Option.getOrUndefined(
    decodeDiscountApplicationId(identifier)
  ),
  dotyposReservationId: Option.getOrUndefined(
    decodeDotyposReservationId(identifier)
  ),
  legalEvidenceEventId: Option.getOrUndefined(
    decodeLegalEvidenceEventId(identifier)
  ),
  nexiOperationId: Option.getOrUndefined(decodeNexiOperationId(identifier)),
  nexiOrderId: Option.getOrUndefined(decodeNexiOrderId(identifier)),
  nexiWebhookEventId: Option.getOrUndefined(
    decodeNexiWebhookEventId(identifier)
  ),
  paymentAttemptId: Option.getOrUndefined(decodePaymentAttemptId(identifier)),
  storedWebhookEventId: Option.getOrUndefined(
    decodeStoredWebhookEventId(identifier)
  ),
  workspaceReservationId: Option.getOrUndefined(
    decodeWorkspaceReservationId(identifier)
  ),
});

/** Matches the column when the identifier decoded as the id it holds. */
const matchesLookupId = <TColumn extends Column>(
  column: TColumn,
  id: TColumn["_"]["data"] | undefined
) => (id ? eq(column, id) : undefined);

/** Any of the matches; none when the identifier decoded as no id they take. */
const anyLookupMatch = (...matches: readonly (SQL | undefined)[]) =>
  or(...matches) ?? sql`false`;

/**
 * The condition each table a reservation lookup searches matches the
 * identifier with, from its reservation's own ids to the payment, discount,
 * legal evidence, and webhook records that belong to one.
 */
export const getReservationLookupConditions = (identifier: string) => {
  const ids = getReservationLookupIds(identifier);
  return {
    reservations: anyLookupMatch(
      matchesLookupId(workspaceReservations.id, ids.workspaceReservationId),
      matchesLookupId(
        workspaceReservations.checkoutSessionKey,
        ids.checkoutSessionKey
      ),
      matchesLookupId(
        workspaceReservations.checkoutAttemptKey,
        ids.checkoutAttemptKey
      ),
      matchesLookupId(workspaceReservations.correlationId, ids.correlationId),
      matchesLookupId(
        workspaceReservations.dotyposReservationId,
        ids.dotyposReservationId
      ),
      matchesLookupId(
        workspaceReservations.activePaymentAttemptId,
        ids.paymentAttemptId
      )
    ),
    paymentAttempts: anyLookupMatch(
      matchesLookupId(paymentAttempts.id, ids.paymentAttemptId),
      matchesLookupId(paymentAttempts.providerOrderId, ids.nexiOrderId),
      matchesLookupId(
        paymentAttempts.lastWebhookEventId,
        ids.nexiWebhookEventId
      ),
      matchesLookupId(
        paymentAttempts.lastProviderOperationId,
        ids.nexiOperationId
      )
    ),
    discountApplications: anyLookupMatch(
      matchesLookupId(discountApplications.id, ids.discountApplicationId)
    ),
    legalEvidenceEvents: anyLookupMatch(
      matchesLookupId(legalEvidenceEvents.id, ids.legalEvidenceEventId)
    ),
    webhookEvents: anyLookupMatch(
      matchesLookupId(webhookEvents.id, ids.storedWebhookEventId),
      matchesLookupId(webhookEvents.eventId, ids.nexiWebhookEventId),
      matchesLookupId(webhookEvents.providerOrderId, ids.nexiOrderId)
    ),
  };
};
