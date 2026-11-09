import { ReferralCode } from "@deskohub/workspace-customer-api/referral-code";
import { Clock, Context, Data, Effect, Layer, Option, Schema } from "effect";
import { AccountScopedStorage } from "../customer-api/account-scoped-storage";
import type { DeviceCapabilityFailed } from "../customer-api/device-capabilities";
import {
  RememberedReferralUpdate,
  type RememberedReferralUpdate as Update,
} from "./remembered-referral";

/**
 * How long a remembered code lasts, as long as the site's referral cookie:
 * `sharedReferralCodeRememberedDays` in
 * apps/deskohub-workspace/features/referrals/program.ts, the cookie's
 * `Max-Age` in apps/deskohub-workspace/features/referrals/referral-code-cookie.ts.
 */
export const rememberedReferralLifetimeDays = 30;

const lifetimeMillis = rememberedReferralLifetimeDays * 24 * 60 * 60 * 1000;

/**
 * The remembered code's entry in the account's storage, which keys it by
 * Workspace origin and account and removes it when the account exits.
 */
export const rememberedReferralStorageName = "deskohub.booking.referral.v1";

/** The device storage failed to read or write. */
export class RememberedReferralStorageUnavailable extends Data.TaggedError(
  "RememberedReferralStorageUnavailable"
)<{ readonly cause: DeviceCapabilityFailed }> {
  static fromDevice = (cause: DeviceCapabilityFailed) =>
    new RememberedReferralStorageUnavailable({ cause });
}

interface IRememberedReferralCode {
  /** The code to send with bookings, while it hasn't expired. */
  readonly get: Effect.Effect<Option.Option<ReferralCode>>;
  /** Remembers `code` for the cookie's lifetime, replacing any other. */
  readonly remember: (code: ReferralCode) => Effect.Effect<void>;
  readonly forget: Effect.Effect<void>;
  /** Applies what a booking response asked for. */
  readonly apply: (update: Update) => Effect.Effect<void>;
}

/**
 * The referral code the app remembers for the signed-in account, as the site's
 * referral cookie does for a browser. Storage failures never fail a booking:
 * a read that fails remembers nothing, a write that fails keeps what was
 * there.
 */
export class RememberedReferralCode extends Context.Service<
  RememberedReferralCode,
  IRememberedReferralCode
>()("deskohub-mobile/RememberedReferralCode") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const storage = yield* AccountScopedStorage;

      const forget = storage
        .removeItem(rememberedReferralStorageName)
        .pipe(
          Effect.mapError(RememberedReferralStorageUnavailable.fromDevice),
          Effect.ignore,
          Effect.withSpan("RememberedReferralCode.forget")
        );

      const remember = Effect.fn("RememberedReferralCode.remember")(
        (code: ReferralCode) =>
          Clock.currentTimeMillis.pipe(
            Effect.flatMap((now) =>
              storage.setItem(
                rememberedReferralStorageName,
                encodeEntry({ code, expiresAt: now + lifetimeMillis })
              )
            ),
            Effect.mapError(RememberedReferralStorageUnavailable.fromDevice),
            Effect.ignore
          )
      );

      /** A failed read remembers nothing. */
      const readStored = storage.getItem(rememberedReferralStorageName).pipe(
        Effect.mapError(RememberedReferralStorageUnavailable.fromDevice),
        Effect.orElseSucceed(() => Option.none<string>())
      );

      const get = Effect.Do.pipe(
        Effect.bind("now", () => Clock.currentTimeMillis),
        Effect.bind("stored", () => readStored),
        Effect.let("live", liveEntry),
        // An expired or unreadable entry is dropped, as a browser drops an
        // expired cookie.
        Effect.tap(({ stored, live }) =>
          Effect.when(
            forget,
            Effect.succeed(Option.isSome(stored) && Option.isNone(live))
          )
        ),
        Effect.map(({ live }) => Option.map(live, ({ code }) => code)),
        Effect.withSpan("RememberedReferralCode.get")
      );

      return RememberedReferralCode.of({
        get,
        remember,
        forget,
        apply: (update) =>
          RememberedReferralUpdate.$match(update, {
            Remember: ({ code }) => remember(code),
            Forget: () => forget,
          }),
      });
    })
  );
}

const StoredReferral = Schema.Struct({
  code: ReferralCode,
  /** Epoch milliseconds. */
  expiresAt: Schema.Finite,
});

const StoredReferralJson = Schema.fromJsonString(StoredReferral);

const encodeEntry = Schema.encodeSync(StoredReferralJson);

const decodeEntry = Schema.decodeUnknownOption(StoredReferralJson);

/** The stored entry while it is readable and unexpired at `now`. */
const liveEntry = ({
  now,
  stored,
}: {
  readonly now: number;
  readonly stored: Option.Option<string>;
}) =>
  Option.flatMap(stored, decodeEntry).pipe(
    Option.filter(({ expiresAt }) => expiresAt > now)
  );
