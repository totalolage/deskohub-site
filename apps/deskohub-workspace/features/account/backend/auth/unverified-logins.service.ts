import { Context, Data, Effect, Layer, Schema } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import { censorLogValue } from "@/shared/backend/logging/censorship";
import type { makeWorkspaceAuth } from "./auth-server";

type WorkspaceAuth = Pick<ReturnType<typeof makeWorkspaceAuth>, "$context">;

/** The login could not be created; the cause is censored for logs. */
class UnverifiedLoginCreationError extends Data.TaggedError(
  "UnverifiedLoginCreationError"
)<{ readonly message: string; readonly cause: unknown }> {
  static from = (cause: unknown) =>
    new UnverifiedLoginCreationError({
      message: "The unverified login could not be created.",
      cause: censorLogValue(cause),
    });
}

interface IUnverifiedLogins {
  /**
   * Creates a login for `email` that is not verified yet, without sending
   * any email. The sign-up hook creates its durable customer account first,
   * with `locale` as the account's preference. The owner verifies the same
   * login by signing in with a link or code sent to the email; until then
   * Workspace rejects its sessions.
   */
  readonly create: (input: {
    readonly email: string;
    readonly locale: Locale;
  }) => Effect.Effect<CustomerAccountId, UnverifiedLoginCreationError>;
}

export class UnverifiedLogins extends Context.Service<
  UnverifiedLogins,
  IUnverifiedLogins
>()("@deskohub-workspace/account/UnverifiedLogins") {
  static makeLayer = (auth: WorkspaceAuth) =>
    Layer.succeed(this, {
      create: Effect.fn("UnverifiedLogins.create")(function* ({
        email,
        locale,
      }) {
        const context = yield* Effect.tryPromise({
          try: () => auth.$context,
          catch: UnverifiedLoginCreationError.from,
        });
        // A server-side creation runs outside any endpoint, where the hook
        // cannot generate the id, so the login brings its own.
        const id = context.generateId({ model: "user" });
        if (id === false) {
          return yield* UnverifiedLoginCreationError.from(
            "Better Auth generates no user ids."
          );
        }
        const user = yield* Effect.tryPromise({
          try: () =>
            context.internalAdapter.createUser(
              { id, email, name: "", emailVerified: false, locale },
              { method: "admin" }
            ),
          catch: UnverifiedLoginCreationError.from,
        });
        return yield* Schema.decodeEffect(customerAccountIdSchema)(
          user.id
        ).pipe(Effect.mapError(UnverifiedLoginCreationError.from));
      }),
    });

  static Live = Layer.unwrap(
    Effect.promise(async () => {
      const { auth } = await import("@/features/account/server/auth.server");
      return UnverifiedLogins.makeLayer(auth);
    })
  );
}
