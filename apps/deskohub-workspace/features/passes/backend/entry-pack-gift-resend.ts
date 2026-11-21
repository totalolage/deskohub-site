import "server-only";

import { Effect } from "effect";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import type { OrderId } from "@/features/order";
import { CoworkPassesReleaseGate } from "./cowork-passes-release-gate";
import { queueEntryPackGiftResend } from "./entry-pack-gift";

export const requestEntryPackGiftResend = Effect.fn(
  "requestEntryPackGiftResend"
)(function* (orderId: OrderId) {
  const gate = yield* CoworkPassesReleaseGate;
  if (!(yield* gate.isOpen)) return "unavailable" as const;
  const account = yield* CurrentCustomerAccount;
  const standing = yield* account.peek;
  if (
    (standing.kind !== "linked" && standing.kind !== "unlinked") ||
    standing.reviewMarker !== "absent"
  ) {
    return "unavailable" as const;
  }
  const { accountId } = standing.session;
  const sections = yield* CustomerAccountSections;
  const queued = yield* sections.withActiveAccount(
    accountId,
    queueEntryPackGiftResend(orderId, accountId),
    { passPurchaseOrderId: orderId }
  );
  return queued ? ("queued" as const) : ("unavailable" as const);
});
