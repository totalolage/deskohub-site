import { Option, Schema } from "effect";
import { isSafeReturnPath } from "./auth-session-state";

/**
 * The account a web reauthentication started from and the screen it returns
 * to, kept in `localStorage` because the sign-in email may open in another
 * tab. A reauthentication only starts, and only sends its email, once this is
 * stored, and it outlives the email's link (ten minutes, the server's
 * `betterAuthMagicLinkOptions`), so a link that can still sign in always
 * finds it.
 */
const storageKey = "deskohub.reauthentication";
export const reauthenticationMarkerTtlMs = 30 * 60 * 1000;

// The return path is checked on read, so a bad one loses only itself.
const storedSchema = Schema.fromJsonString(
  Schema.Struct({
    userId: Schema.String,
    expiresAt: Schema.Finite,
    returnPath: Schema.optionalKey(Schema.Unknown),
  })
);
const decodeStored = Schema.decodeUnknownOption(storedSchema);

const read = Option.liftThrowable(() =>
  globalThis.localStorage.getItem(storageKey)
);
const write = Option.liftThrowable((value: string) =>
  globalThis.localStorage.setItem(storageKey, value)
);
const remove = Option.liftThrowable(() =>
  globalThis.localStorage.removeItem(storageKey)
);

export interface StoredReauthentication {
  readonly userId: string;
  /** A router path (without the `/app` base); none when unsafe or absent. */
  readonly returnPath: Option.Option<string>;
}

/** Stores the account; `false` when this browser refuses storage. */
export const saveReauthenticatingUser = (
  {
    userId,
    returnPath,
  }: { readonly userId: string; readonly returnPath: string },
  now: number
): boolean =>
  Option.isSome(
    write(
      JSON.stringify({
        userId,
        expiresAt: now + reauthenticationMarkerTtlMs,
        returnPath,
      })
    )
  );

export const loadReauthentication = (
  now: number
): Option.Option<StoredReauthentication> =>
  read().pipe(
    Option.flatMap((raw) => Option.fromNullishOr(raw)),
    Option.flatMap(decodeStored),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ userId, returnPath }) => ({
      userId,
      returnPath: Option.liftPredicate(returnPath, isSafeReturnPath),
    }))
  );

export const loadReauthenticatingUser = (now: number): Option.Option<string> =>
  Option.map(loadReauthentication(now), ({ userId }) => userId);

export const clearReauthenticatingUser = (): void => {
  remove();
};
