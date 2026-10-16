import { getAuthenticatorName } from "@better-auth/passkey";
import { Context, Effect, Layer, Schema } from "effect";
import { headers } from "next/headers";
import type { AccountPasskey } from "@/features/account/passkeys";
import { CurrentWorkspaceRequestHeaders } from "@/shared/backend/workspace-request-context";
import {
  type CustomerAccountAccessError,
  customerAccountUnavailable,
} from "../../customer-account";

const passkeyRowSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.NullOr(Schema.String)),
  aaguid: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Union([Schema.Date, Schema.String]),
});
const decodePasskeyRows = Schema.decodeUnknownEffect(
  Schema.Array(passkeyRowSchema)
);

/**
 * The account-page view of a passkey row: its provider comes from the
 * authenticator AAGUID, and no credential material leaves the server.
 */
const toAccountPasskey = (
  row: typeof passkeyRowSchema.Type
): AccountPasskey => ({
  id: row.id,
  name: row.name ?? undefined,
  provider: getAuthenticatorName(row.aaguid),
  createdAt: new Date(row.createdAt).toISOString(),
});

const passkeysUnavailable = () =>
  customerAccountUnavailable("authentication.passkeys");

interface ICustomerPasskeys {
  /** The current session account's passkeys, oldest first. */
  readonly list: Effect.Effect<
    readonly AccountPasskey[],
    CustomerAccountAccessError
  >;
}

export class CustomerPasskeys extends Context.Service<
  CustomerPasskeys,
  ICustomerPasskeys
>()("@deskohub-workspace/account/CustomerPasskeys") {
  static Default = Layer.succeed(this, {
    list: Effect.flatMap(CurrentWorkspaceRequestHeaders, (captured) =>
      Effect.tryPromise({
        try: async () => {
          const { auth } = await import(
            "@/features/account/server/auth.server"
          );
          return auth.api.listPasskeys({
            // Actions and routes capture headers at their request boundary.
            headers: captured ?? (await headers()),
          });
        },
        catch: passkeysUnavailable,
      })
    ).pipe(
      Effect.flatMap((rows) =>
        decodePasskeyRows(rows).pipe(Effect.mapError(passkeysUnavailable))
      ),
      Effect.map((rows) =>
        rows
          .map(toAccountPasskey)
          .toSorted((left, right) =>
            left.createdAt.localeCompare(right.createdAt)
          )
      ),
      Effect.withSpan("CustomerPasskeys.list")
    ),
  });
}
