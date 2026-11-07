import { Option, Schema } from "effect";

/**
 * The account a web reauthentication started from, kept in `localStorage`
 * because the sign-in email may open in another tab. A reauthentication only
 * starts, and only sends its email, once this is stored, and it outlives the
 * email's link (ten minutes, the server's `betterAuthMagicLinkOptions`), so a
 * link that can still sign in always finds it.
 */
const storageKey = "deskohub.reauthentication";
export const reauthenticationMarkerTtlMs = 30 * 60 * 1000;

const storedSchema = Schema.fromJsonString(
  Schema.Struct({ userId: Schema.String, expiresAt: Schema.Finite })
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

/** Stores the account; `false` when this browser refuses storage. */
export const saveReauthenticatingUser = (
  userId: string,
  now: number
): boolean =>
  Option.isSome(
    write(
      JSON.stringify({ userId, expiresAt: now + reauthenticationMarkerTtlMs })
    )
  );

export const loadReauthenticatingUser = (now: number): Option.Option<string> =>
  read().pipe(
    Option.flatMap((raw) => Option.fromNullishOr(raw)),
    Option.flatMap(decodeStored),
    Option.filter(({ expiresAt }) => now < expiresAt),
    Option.map(({ userId }) => userId)
  );

export const clearReauthenticatingUser = (): void => {
  remove();
};
