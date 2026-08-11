import {
  DotyposCustomerIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import {
  NexiOperationIdSchema,
  NexiOrderIdSchema,
  NexiWebhookEventIdSchema,
} from "@deskohub/nexi";
import { accountingSnapshotKeyIdSchema } from "@/features/accounting/accounting-document-snapshot";
import {
  checkoutAttemptIdSchema,
  checkoutSessionIdSchema,
  checkoutSessionKeySchema,
  paymentAttemptIdSchema,
  storedWebhookEventIdSchema,
} from "@/features/checkout/checkout-identifiers";
import { legalEvidenceEventIdSchema } from "@/features/checkout/legal-evidence";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";
import {
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";

const workspaceReservationId = workspaceReservationIdSchema.make("reservation");
const paymentAttemptId = paymentAttemptIdSchema.make("payment-attempt");
const checkoutSessionId = checkoutSessionIdSchema.make("checkout-session");
const checkoutAttemptId = checkoutAttemptIdSchema.make("checkout-attempt");
const checkoutSessionKey = checkoutSessionKeySchema.make(
  "checkout-session-key"
);
const storedWebhookEventId = storedWebhookEventIdSchema.make("stored-event");
const nexiWebhookEventId = NexiWebhookEventIdSchema.make("provider-event");
const nexiOrderId = NexiOrderIdSchema.make("provider-order");
const nexiOperationId = NexiOperationIdSchema.make("provider-operation");
const dotyposCustomerId = DotyposCustomerIdSchema.make("customer");
const dotyposReservationId = DotyposReservationIdSchema.make("reservation");
const salesCalendarId = salesCalendarIdSchema.make("sales-calendar");
const limitationsCalendarId = workspaceLimitationsCalendarIdSchema.make(
  "limitations-calendar"
);
const accountingKeyId = accountingSnapshotKeyIdSchema.make("K202608");
const legalEvidenceEventId = legalEvidenceEventIdSchema.make("legal-event");

const acceptWorkspaceReservationId = (_id: typeof workspaceReservationId) =>
  undefined;
const acceptPaymentAttemptId = (_id: typeof paymentAttemptId) => undefined;
const acceptCheckoutSessionId = (_id: typeof checkoutSessionId) => undefined;
const acceptCheckoutSessionKey = (_id: typeof checkoutSessionKey) => undefined;
const acceptStoredWebhookEventId = (_id: typeof storedWebhookEventId) =>
  undefined;
const acceptNexiOrderId = (_id: typeof nexiOrderId) => undefined;
const acceptDotyposCustomerId = (_id: typeof dotyposCustomerId) => undefined;
const acceptSalesCalendarId = (_id: typeof salesCalendarId) => undefined;
const acceptAccountingKeyId = (_id: typeof accountingKeyId) => undefined;
const acceptLegalEvidenceEventId = (_id: typeof legalEvidenceEventId) =>
  undefined;

acceptWorkspaceReservationId(workspaceReservationId);
acceptPaymentAttemptId(paymentAttemptId);
acceptCheckoutSessionId(checkoutSessionId);
acceptCheckoutSessionKey(checkoutSessionKey);
acceptStoredWebhookEventId(storedWebhookEventId);
acceptNexiOrderId(nexiOrderId);
acceptDotyposCustomerId(dotyposCustomerId);
acceptSalesCalendarId(salesCalendarId);
acceptAccountingKeyId(accountingKeyId);
acceptLegalEvidenceEventId(legalEvidenceEventId);

// @ts-expect-error Raw strings must be decoded before entering an ID contract.
acceptWorkspaceReservationId("reservation");
// @ts-expect-error Database entity IDs are not interchangeable.
acceptWorkspaceReservationId(paymentAttemptId);
// @ts-expect-error Checkout attempts cannot be used as checkout sessions implicitly.
acceptCheckoutSessionId(checkoutAttemptId);
// @ts-expect-error Derived lookup keys cannot be replaced with raw session IDs.
acceptCheckoutSessionKey(checkoutSessionId);
// @ts-expect-error Provider webhook IDs are not local webhook row IDs.
acceptStoredWebhookEventId(nexiWebhookEventId);
// @ts-expect-error Nexi operations are not Nexi orders.
acceptNexiOrderId(nexiOperationId);
// @ts-expect-error Dotypos reservations are not Dotypos customers.
acceptDotyposCustomerId(dotyposReservationId);
// @ts-expect-error Calendar roles remain distinct even though both call Google Calendar.
acceptSalesCalendarId(limitationsCalendarId);
// @ts-expect-error Encryption key IDs cannot be confused with legal-evidence row IDs.
acceptAccountingKeyId(legalEvidenceEventId);
// @ts-expect-error Legal-evidence row IDs cannot be confused with reservation IDs.
acceptLegalEvidenceEventId(workspaceReservationId);
