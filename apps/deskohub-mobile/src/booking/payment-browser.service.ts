import { Context, Data, Effect, Layer, Match } from "effect";
import type { WebBrowserAuthSessionResult } from "expo-web-browser";

/**
 * How the payment gateway's page ended: it redirected to the return URL, or
 * the customer closed it. Neither says whether the payment went through; the
 * reservation's status screen tells.
 */
export type PaymentBrowserResult = "returned" | "dismissed";

/** The payment page couldn't open, such as while another browser session is open. */
export class PaymentBrowserUnavailable extends Data.TaggedError(
  "PaymentBrowserUnavailable"
)<{ readonly cause: unknown }> {}

interface IPaymentBrowser {
  /**
   * Opens the gateway's `paymentUrl`. On native the in-app browser closes
   * when the gateway redirects to `returnUrl`; on web the page leaves for
   * the gateway, so the Effect never completes.
   */
  readonly open: (
    paymentUrl: string,
    returnUrl: string
  ) => Effect.Effect<PaymentBrowserResult, PaymentBrowserUnavailable>;
}

/** Expo's auth session, which the native payment page runs in. */
type AuthSessionSource = (
  url: string,
  redirectUrl: string
) => Promise<WebBrowserAuthSessionResult>;

/** The browser location the web payment page replaces. */
interface PaymentLocation {
  readonly assign: (url: string) => void;
}

export class PaymentBrowser extends Context.Service<
  PaymentBrowser,
  IPaymentBrowser
>()("deskohub-mobile/PaymentBrowser") {
  static fromAuthSession = (openAuthSession: AuthSessionSource) =>
    Layer.succeed(this, {
      open: (paymentUrl, returnUrl) =>
        Effect.tryPromise({
          try: () => openAuthSession(paymentUrl, returnUrl),
          catch: (cause) => new PaymentBrowserUnavailable({ cause }),
        }).pipe(Effect.flatMap(authSessionResult)),
    });

  static fromLocation = (location: PaymentLocation) =>
    Layer.succeed(this, {
      open: (paymentUrl) =>
        Effect.try({
          try: () => location.assign(paymentUrl),
          catch: (cause) => new PaymentBrowserUnavailable({ cause }),
        }).pipe(Effect.andThen(Effect.never)),
    });
}

/**
 * `locked` means another browser session is still open, so this one never
 * showed. Android reports `opened` or `dismiss` when the app comes back
 * without the redirect.
 */
const authSessionResult = (
  result: WebBrowserAuthSessionResult
): Effect.Effect<PaymentBrowserResult, PaymentBrowserUnavailable> =>
  Match.value<AuthSessionResultType>(result.type).pipe(
    Match.when("success", () => Effect.succeed("returned" as const)),
    Match.whenOr("cancel", "dismiss", "opened", () =>
      Effect.succeed("dismissed" as const)
    ),
    Match.when("locked", () =>
      Effect.fail(new PaymentBrowserUnavailable({ cause: result }))
    ),
    Match.exhaustive
  );

/** Expo's result types as their string values. */
type AuthSessionResultType = `${WebBrowserAuthSessionResult["type"]}`;

const appScheme = /^deskohub:/i;

/**
 * Where the payment page returns to: the submission's `statusUrl` once the
 * server addresses the app (`deskohub:`), else the app's status screen for
 * the order.
 */
export const paymentReturnUrl = (orderId: string, statusUrl: string): string =>
  appScheme.test(statusUrl)
    ? statusUrl
    : `deskohub://reservations/${encodeURIComponent(orderId)}?after=payment`;
