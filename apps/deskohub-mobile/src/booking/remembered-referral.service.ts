import { ReferralCode } from "@deskohub/workspace-customer-api/referral-code";
import { Clock, Context, Data, Effect, Layer, Option, Schema } from "effect";
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
 * Every remembered code's storage key starts with this. The app's sign-out
 * cleanup removes keys under `deskohub.booking.`.
 */
export const rememberedReferralKeyPrefix = "deskohub.booking.referral.v1.";

/** Whose code it is: one account against one Workspace origin. */
export interface RememberedReferralScope {
  readonly apiOrigin: string;
  readonly accountId: string;
}

export const rememberedReferralKey = ({
  apiOrigin,
  accountId,
}: RememberedReferralScope): string =>
  `${rememberedReferralKeyPrefix}${apiOrigin}.${accountId}`;

/** The device storage failed to read or write. */
export class RememberedReferralStorageUnavailable extends Data.TaggedError(
  "RememberedReferralStorageUnavailable"
)<{ readonly cause: unknown }> {}

interface IRememberedReferralStorage {
  readonly getItem: (
    key: string
  ) => Effect.Effect<
    Option.Option<string>,
    RememberedReferralStorageUnavailable
  >;
  readonly setItem: (
    key: string,
    value: string
  ) => Effect.Effect<void, RememberedReferralStorageUnavailable>;
  readonly removeItem: (
    key: string
  ) => Effect.Effect<void, RememberedReferralStorageUnavailable>;
}

/** The key-value device storage the remembered code is kept in. */
export class RememberedReferralStorage extends Context.Service<
  RememberedReferralStorage,
  IRememberedReferralStorage
>()("deskohub-mobile/RememberedReferralStorage") {}

interface IRememberedReferralCode {
  /** The code to send with bookings, while it hasn't expired. */
  readonly get: (
    scope: RememberedReferralScope
  ) => Effect.Effect<Option.Option<ReferralCode>>;
  /** Remembers `code` for the cookie's lifetime, replacing any other. */
  readonly remember: (
    scope: RememberedReferralScope,
    code: ReferralCode
  ) => Effect.Effect<void>;
  readonly forget: (scope: RememberedReferralScope) => Effect.Effect<void>;
  /** Applies what a booking response asked for. */
  readonly apply: (
    scope: RememberedReferralScope,
    update: Update
  ) => Effect.Effect<void>;
}

/**
 * The referral code the app remembers for a signed-in account, as the site's
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
      const storage = yield* RememberedReferralStorage;

      const forget = Effect.fn("RememberedReferralCode.forget")(function* (
        scope: RememberedReferralScope
      ) {
        yield* storage
          .removeItem(rememberedReferralKey(scope))
          .pipe(Effect.ignore);
      });

      const remember = Effect.fn("RememberedReferralCode.remember")(function* (
        scope: RememberedReferralScope,
        code: ReferralCode
      ) {
        const now = yield* Clock.currentTimeMillis;
        yield* storage
          .setItem(
            rememberedReferralKey(scope),
            encodeEntry({ code, expiresAt: now + lifetimeMillis })
          )
          .pipe(Effect.ignore);
      });

      const get = Effect.fn("RememberedReferralCode.get")(function* (
        scope: RememberedReferralScope
      ) {
        const now = yield* Clock.currentTimeMillis;
        const stored = yield* storage
          .getItem(rememberedReferralKey(scope))
          .pipe(Effect.orElseSucceed(() => Option.none<string>()));
        const entry = Option.flatMap(stored, decodeEntry);
        const live = Option.filter(entry, ({ expiresAt }) => expiresAt > now);
        // An expired or unreadable entry is dropped, as a browser drops an
        // expired cookie.
        yield* Effect.when(
          forget(scope),
          Effect.sync(() => Option.isSome(stored) && Option.isNone(live))
        );
        return Option.map(live, ({ code }) => code);
      });

      return RememberedReferralCode.of({
        get,
        remember,
        forget,
        apply: (scope, update) =>
          RememberedReferralUpdate.$match(update, {
            Remember: ({ code }) => remember(scope, code),
            Forget: () => forget(scope),
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
