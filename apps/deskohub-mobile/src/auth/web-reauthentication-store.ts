import { Option, Schema } from "effect";

/**
 * The account a web reauthentication started from, kept in `localStorage`
 * because the sign-in email may open in another tab. It expires with the
 * sign-in it belongs to.
 */
const storageKey = "deskohub.reauthentication";
const ttlMs = 10 * 60 * 1000;

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

export const saveReauthenticatingUser = (userId: string, now: number): void => {
  write(JSON.stringify({ userId, expiresAt: now + ttlMs }));
};

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
