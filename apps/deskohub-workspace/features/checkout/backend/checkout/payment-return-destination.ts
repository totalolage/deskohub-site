import { Effect, Match } from "effect";
import { nativeApp } from "@/features/account";
import type { PaymentReturnTarget } from "@/features/checkout/payment-return-target";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";
import { appendVercelPreviewProtectionBypass } from "./vercel-preview-protection-bypass";

/**
 * Where a hosted payment's return sends the customer of an app checkout, and
 * the `statusUrl` its submission answers: the order's reservation screen in
 * the native app (its custom scheme, which ends the app's payment browser
 * session) or in the web app under `/app/` on the Workspace origin. The
 * `after=payment` query tells the screen the customer just paid, so it polls
 * on the post-payment schedule even when the app opens cold from the link.
 */
export const getPaymentReturnDestination = Effect.fn(
  "checkout.getPaymentReturnDestination"
)(function* (input: {
  readonly target: PaymentReturnTarget;
  readonly orderId: WorkspaceReservationId;
}) {
  const reservationPath = `reservations/${encodeURIComponent(input.orderId)}?after=payment`;
  return yield* Match.value(input.target).pipe(
    Match.when("native-app", () =>
      Effect.succeed(`${nativeApp.scheme}://${reservationPath}`)
    ),
    Match.when("web-app", () =>
      getWorkspaceRuntimeCallbackOrigin.pipe(
        Effect.map((origin) => {
          const url = new URL(`/app/${reservationPath}`, origin);
          appendVercelPreviewProtectionBypass(url, { setBypassCookie: true });
          return url.toString();
        })
      )
    ),
    Match.exhaustive
  );
});
