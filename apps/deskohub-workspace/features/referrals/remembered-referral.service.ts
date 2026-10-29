import type { DotyposCustomerId } from "@deskohub/dotypos";
import { Context, Data, Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account";
import {
  type CanonicalPromotionCode,
  canonicalPromotionCodeSchema,
} from "@/features/discounts/contracts";
import { getRequestCookies } from "@/shared/backend/utils/request-cookies";
import { getRequestHeaders } from "@/shared/backend/utils/request-headers";
import { catchRecoverableCause } from "@/shared/backend/workspace-effect";
import type { ReferralCode } from "./client";
import { ReferralService } from "./referral.service";
import {
  clearReferralCodeCookie,
  parseSharedReferralCode,
  referralCodeCookieName,
  setReferralCodeCookie,
} from "./referral-code-cookie";
import { ReferralFeatureFlagService } from "./referral-feature-flag.service";

/**
 * Whose referral the remembered code serves. Booking for someone else never
 * settles the booker's code.
 */
type Booker =
  /** The linked customer an account page or action resolved for the session. */
  | { readonly kind: "account"; readonly customerId: DotyposCustomerId }
  /**
   * A checkout order. The booker is the signed-in account's linked customer.
   * When the session no longer has one, such as after signing out before
   * paying, the booked customer stands in, and a paid order settles it.
   */
  | {
      readonly kind: "order";
      readonly paid: boolean;
      readonly bookedCustomerId?: DotyposCustomerId;
    };

/** Who a checkout booking is for. */
type BookingFor =
  | { readonly for: "account"; readonly customerId: DotyposCustomerId }
  | { readonly for: "someone-else" };

/** What a checkout booking takes from the remembered code. */
export type RememberedReferralForBooking =
  /** Nothing: no usable code, a withheld program, or a failed check. */
  | { readonly kind: "none" }
  /**
   * The account's own booking takes its referral. It carries the code while
   * the code is eligible; an already accepted referral needs none.
   */
  | {
      readonly kind: "carried";
      readonly referralCode?: CanonicalPromotionCode;
    }
  /** A booking for someone else prefills the Pay page's code box. */
  | { readonly kind: "prefill"; readonly code: CanonicalPromotionCode };

class RememberedReferralError extends Data.TaggedError(
  "RememberedReferralError"
)<{ readonly cause: unknown }> {}

interface IRememberedReferral {
  /**
   * The code this browser remembers from a shared link or an accepted
   * checkout code, for account sign-up to record or prefill. Undefined when
   * there is none, while the referral program is withheld, or when it can't
   * be read.
   */
  readonly code: Effect.Effect<ReferralCode | undefined>;
  /**
   * What a checkout booking takes from the remembered code: the account's own
   * booking carries an eligible referral, and a booking for someone else gets
   * a usable code as the code box prefill. A failure takes nothing.
   */
  readonly forBooking: (
    booking: BookingFor
  ) => Effect.Effect<RememberedReferralForBooking>;
  /**
   * Remembers a referral code the customer typed and checkout accepted,
   * replacing any shared-link code, so an order edit keeps it. Server Actions
   * and route handlers only; nothing is written while the program is
   * withheld.
   */
  readonly remember: (
    code: CanonicalPromotionCode
  ) => Effect.Effect<void, RememberedReferralError>;
  /**
   * Forgets the remembered code once the booker's referral is settled.
   * Server Actions and route handlers only. Checks only when a code is
   * remembered; a failure keeps the code and never fails the caller.
   */
  readonly forgetIfSettled: (booker: Booker) => Effect.Effect<void>;
  /**
   * Whether a remembered code is settled for the booker, for a Server
   * Component page, which can't write cookies and renders
   * `ForgetRememberedReferralCode` instead. False without a code or when the
   * check fails.
   */
  readonly isSettled: (booker: Booker) => Effect.Effect<boolean>;
}

/**
 * The referral code a browser remembers, and what bookings and accounts do
 * with it. Every read follows the request's referral release decision.
 */
export class RememberedReferral extends Context.Service<
  RememberedReferral,
  IRememberedReferral
>()("@deskohub-workspace/referrals/RememberedReferral") {
  /** The site's browser cookie (`referral-code-cookie.ts`). */
  static Cookies = Layer.effect(this, makeRememberedReferral(nextCookieJar()));

  /** A channel without a browser, such as an AI agent's tool call. */
  static none = Layer.succeed(this, {
    code: Effect.undefined,
    forBooking: () => Effect.succeed(none),
    remember: () => Effect.void,
    forgetIfSettled: () => Effect.void,
    isSettled: () => Effect.succeed(false),
  } satisfies IRememberedReferral);

  /**
   * A cookie held in `cookie`, for tests. With `writable: false` every write
   * fails, as Next.js refuses cookie writes while it renders a Server
   * Component or prerenders a page.
   */
  static inMemory = (
    cookie: InMemoryReferralCookie,
    options: { readonly writable?: boolean } = {}
  ) =>
    Layer.effect(
      this,
      makeRememberedReferral(inMemoryJar(cookie, options.writable ?? true))
    );
}

/** The cookie value a browser sends; a write replaces it. */
export type InMemoryReferralCookie = { value?: string };

/** The storage behind the remembered code. */
interface ReferralCodeJar {
  readonly read: Effect.Effect<string | undefined, RememberedReferralError>;
  readonly write: (
    code: ReferralCode
  ) => Effect.Effect<void, RememberedReferralError>;
  readonly clear: Effect.Effect<void, RememberedReferralError>;
}

function makeRememberedReferral(jar: ReferralCodeJar) {
  return Effect.gen(function* () {
    const release = yield* ReferralFeatureFlagService;
    const referrals = yield* ReferralService;
    const contacts = yield* CustomerAccountContactService;

    // A withheld program ignores the remembered code.
    const read = release.isEnabled.pipe(
      Effect.flatMap((released) =>
        released
          ? jar.read.pipe(Effect.map(parseSharedReferralCode))
          : Effect.undefined
      )
    );

    const isBookerSettled = Effect.fn(function* (booker: Booker) {
      if (booker.kind === "account") {
        return yield* referrals.hasSettledReferral({
          dotyposCustomerId: booker.customerId,
        });
      }
      const account = yield* contacts.currentAccount;
      if (account.status === "linked") {
        return yield* referrals.hasSettledReferral({
          dotyposCustomerId: account.dotyposCustomerId,
        });
      }
      // An account without a profile yet has no referral of its own.
      if (account.status === "unlinked") return false;
      if (booker.paid) return true;
      if (booker.bookedCustomerId === undefined) return false;
      return yield* referrals.hasSettledReferral({
        dotyposCustomerId: booker.bookedCustomerId,
      });
    });

    // Without a remembered code there is nothing to settle, so the booker's
    // history is not read.
    const isRememberedCodeSettled = (booker: Booker) =>
      read.pipe(
        Effect.flatMap((code) =>
          code === undefined ? Effect.succeed(false) : isBookerSettled(booker)
        )
      );

    return {
      code: read.pipe(keepOnFailure(undefined)),
      forBooking: Effect.fn("RememberedReferral.forBooking")(function* (
        booking: BookingFor
      ) {
        const code = yield* read;
        if (code === undefined) return none;
        if (booking.for === "account") {
          const evaluation = yield* referrals
            .evaluateCheckoutReferral({
              code,
              dotyposCustomerId: booking.customerId,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logInfo("Checkout referral code was not carried", {
                  reason: error.reason,
                }).pipe(Effect.as(undefined))
              )
            );
          if (evaluation === undefined) return none;
          return (
            evaluation.kind === "eligible"
              ? {
                  kind: "carried",
                  referralCode: canonicalPromotionCodeSchema.make(
                    evaluation.code
                  ),
                }
              : { kind: "carried" }
          ) satisfies RememberedReferralForBooking;
        }
        const availableCode = yield* referrals.findAvailableCode({ code }).pipe(
          Effect.catch((error) =>
            Effect.logInfo("Checkout referral code prefill was skipped", {
              reason: error.reason,
            }).pipe(Effect.as(undefined))
          )
        );
        if (availableCode === undefined) return none;
        return {
          kind: "prefill",
          code: canonicalPromotionCodeSchema.make(availableCode),
        } satisfies RememberedReferralForBooking;
      }, keepOnFailure(none)),
      remember: Effect.fn("RememberedReferral.remember")(function* (
        code: CanonicalPromotionCode
      ) {
        if (!(yield* release.isEnabled)) return;
        const referralCode = parseSharedReferralCode(code);
        if (referralCode !== undefined) yield* jar.write(referralCode);
      }),
      forgetIfSettled: Effect.fn("RememberedReferral.forgetIfSettled")(
        function* (booker: Booker) {
          if (yield* isRememberedCodeSettled(booker)) yield* jar.clear;
        },
        keepOnFailure(undefined)
      ),
      isSettled: Effect.fn("RememberedReferral.isSettled")(function* (
        booker: Booker
      ) {
        return yield* isRememberedCodeSettled(booker);
      }, keepOnFailure(false)),
    } satisfies IRememberedReferral;
  });
}

const none: RememberedReferralForBooking = { kind: "none" };

/**
 * Answers a failed read, check, or write with `fallback` under one log code,
 * keeping the remembered code. Interruption and Next.js control flow, such as
 * a prerender that can't read cookies, propagate.
 */
const keepOnFailure = <B>(fallback: B) =>
  catchRecoverableCause(() =>
    Effect.logWarning("Remembered referral code unavailable").pipe(
      Effect.annotateLogs({
        code: "referrals.remembered-referral.unavailable",
      }),
      Effect.as(fallback)
    )
  );

function nextCookieJar(): ReferralCodeJar {
  const writeCookie = (
    write: (
      jar: Parameters<typeof setReferralCodeCookie>[0],
      secure: boolean
    ) => unknown
  ) =>
    Effect.all([getRequestCookies, getRequestHeaders]).pipe(
      Effect.mapError((cause) => new RememberedReferralError({ cause })),
      Effect.flatMap(([jar, headers]) =>
        Effect.try({
          try: () => {
            write(jar, headers.get("x-forwarded-proto") !== "http");
          },
          catch: (cause) => new RememberedReferralError({ cause }),
        })
      )
    );

  return {
    read: getRequestCookies.pipe(
      Effect.map((jar) => jar.get(referralCodeCookieName)?.value),
      Effect.mapError((cause) => new RememberedReferralError({ cause }))
    ),
    write: (code) =>
      writeCookie((jar, secure) => setReferralCodeCookie(jar, code, secure)),
    clear: writeCookie(clearReferralCodeCookie),
  };
}

function inMemoryJar(
  cookie: InMemoryReferralCookie,
  writable: boolean
): ReferralCodeJar {
  const write = (value: string | undefined) =>
    writable
      ? Effect.sync(() => {
          cookie.value = value;
        })
      : Effect.fail(
          new RememberedReferralError({
            cause: new Error("Cookies can't be written while rendering."),
          })
        );
  return {
    read: Effect.sync(() => cookie.value),
    write,
    clear: write(undefined),
  };
}
