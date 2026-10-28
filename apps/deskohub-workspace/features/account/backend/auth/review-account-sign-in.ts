import { createHash, timingSafeEqual } from "node:crypto";
import { APIError, type AuthContext } from "better-auth";
import { isAPIError } from "better-auth/api";
import { createLocalAccountIssuer } from "better-auth/db";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Data, Effect, Option, Predicate, Schema } from "effect";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { ReviewAccountCredential } from "./review-account-credentials";
import { digestAddress, type SignInEmailLock } from "./sign-in-code";

/**
 * App-directory review logins sign in with an email and password through
 * Better Auth's own credential sign-in; nobody else can. The first sign-in of
 * an allowlisted address provisions its login, and later ones repair it, so
 * nothing is written on deploy and a repeat sign-in writes nothing.
 */

export type ReviewLoginConfig = {
  /** The allowlisted review logins, from `REVIEW_ACCOUNT_CREDENTIALS`. */
  readonly reviewAccountCredentials: readonly ReviewAccountCredential[];
  /** Whether the durable account is marked as a review account. */
  readonly isReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<boolean, EffectDrizzleQueryError>;
  /**
   * Creates the marked durable account of a new review login, before Better
   * Auth inserts the login under the same id.
   */
  readonly registerReviewAccount: (
    accountId: CustomerAccountId
  ) => Effect.Effect<void, EffectDrizzleQueryError>;
  readonly withSignInEmailLock: SignInEmailLock;
};

/**
 * Better Auth's own answer to an unknown email or a wrong password, so a
 * refused address reads like any failed password sign-in.
 */
export const makeInvalidEmailOrPasswordError = () =>
  new APIError("UNAUTHORIZED", {
    code: "INVALID_EMAIL_OR_PASSWORD",
    message: "Invalid email or password",
  });

const digestPassword = (password: string) =>
  createHash("sha256").update(password).digest();

/**
 * Whether a sign-in carries the review login's configured password, compared
 * in constant time. Only the configured password signs in and provisions:
 * an earlier password stops working as soon as it is rotated, a wrong one
 * writes nothing, and a deployment still running the old configuration
 * during a rollout can't rehash over the new one with the new password.
 */
export const isConfiguredPassword = (
  credential: ReviewAccountCredential,
  password: string
) =>
  timingSafeEqual(
    digestPassword(credential.password),
    digestPassword(password)
  );

/** A review login's auth rows could not be read or written. */
class ReviewLoginStorageError extends Data.TaggedError(
  "ReviewLoginStorageError"
)<Record<never, never>> {
  override readonly message = "A review login could not be read or written.";
}

/** Better Auth generated no usable account id for a new review login. */
class ReviewLoginIdInvalidError extends Data.TaggedError(
  "ReviewLoginIdInvalidError"
)<Record<never, never>> {
  override readonly message =
    "The review login being created has no valid account identifier.";
}

const credentialIssuer = createLocalAccountIssuer("credential");

type ReviewLoginContext = Pick<
  AuthContext,
  "internalAdapter" | "password" | "generateId"
>;

type ReviewLoginProvisioning = {
  readonly config: ReviewLoginConfig;
  readonly credential: ReviewAccountCredential;
  readonly context: ReviewLoginContext;
  /** The sign-in's callback locale, seeding a new login's preference. */
  readonly locale: Locale | undefined;
};

const storage = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new ReviewLoginStorageError(),
  });

const decodeAccountId = Schema.decodeUnknownOption(customerAccountIdSchema);

/**
 * Adds the credential the way Better Auth's own `setPassword` does: the
 * login's id as the account id, under the local credential issuer.
 */
const linkCredential = (
  { credential, context }: ReviewLoginProvisioning,
  userId: string
) =>
  storage(() => context.password.hash(credential.password)).pipe(
    Effect.flatMap((password) =>
      storage(() =>
        context.internalAdapter.linkAccount({
          userId,
          providerId: "credential",
          issuer: credentialIssuer,
          accountId: userId,
          password,
        })
      )
    ),
    Effect.asVoid
  );

/**
 * A new review login: the marked durable account first, then the login
 * under the same id (its creation hook finds the account already there),
 * then the credential. A failure part-way leaves either an unused marked
 * account, which the auth cleanup cron tombstones, or a login without a
 * credential, which the next sign-in repairs.
 */
const createReviewLogin = Effect.fn("WorkspaceAuth.createReviewLogin")(
  function* (provisioning: ReviewLoginProvisioning) {
    const { config, credential, context, locale } = provisioning;
    const accountId = yield* Option.match(
      decodeAccountId(context.generateId({ model: "user" })),
      {
        onNone: () => Effect.fail(new ReviewLoginIdInvalidError()),
        onSome: Effect.succeed,
      }
    );
    yield* config.registerReviewAccount(accountId);
    yield* storage(() =>
      context.internalAdapter.createUser(
        {
          id: accountId,
          email: credential.email,
          emailVerified: true,
          name: "",
          ...(locale !== undefined && { locale }),
        },
        { method: "email-password" }
      )
    );
    yield* linkCredential(provisioning, accountId);
  }
);

type ExistingLogin = NonNullable<
  Awaited<ReturnType<ReviewLoginContext["internalAdapter"]["findUserByEmail"]>>
>;

/**
 * An existing review login gets a missing credential back, and a new hash
 * when the configured password changed. A login that isn't a review account
 * is never given a password.
 */
const repairReviewLogin = Effect.fn("WorkspaceAuth.repairReviewLogin")(
  function* (
    provisioning: ReviewLoginProvisioning,
    { user, accounts }: ExistingLogin
  ) {
    const { config, credential, context } = provisioning;
    const isReviewAccount = yield* Option.match(decodeAccountId(user.id), {
      onNone: () => Effect.succeed(false),
      onSome: config.isReviewAccount,
    });
    if (!isReviewAccount) {
      yield* Effect.logWarning(
        "A review login's address belongs to a customer login; password sign-in refused.",
        { code: "account.review-login.customer-login" }
      );
      return yield* Effect.fail(makeInvalidEmailOrPasswordError());
    }
    const stored = accounts.find(
      (account) =>
        account.providerId === "credential" &&
        account.issuer === credentialIssuer &&
        account.accountId === user.id
    );
    if (stored === undefined) {
      return yield* linkCredential(provisioning, user.id);
    }
    const hash = stored.password;
    const current =
      Predicate.isString(hash) &&
      (yield* storage(() =>
        context.password.verify({ hash, password: credential.password })
      ));
    if (current) return;
    const password = yield* storage(() =>
      context.password.hash(credential.password)
    );
    yield* storage(() =>
      context.internalAdapter.updatePassword(user.id, password)
    );
  }
);

/**
 * Makes sure an allowlisted address has its review login before Better
 * Auth's credential sign-in verifies the password. Runs under the address's
 * sign-in lock, so concurrent first sign-ins create one login.
 */
export const provisionReviewLogin = (provisioning: ReviewLoginProvisioning) =>
  digestAddress(provisioning.credential).pipe(
    Effect.flatMap((address) =>
      provisioning.config.withSignInEmailLock(
        address,
        storage(() =>
          provisioning.context.internalAdapter.findUserByEmail(
            provisioning.credential.email,
            { includeAccounts: true }
          )
        ).pipe(
          Effect.flatMap(
            (
              existing
            ): Effect.Effect<
              void,
              | APIError
              | EffectDrizzleQueryError
              | ReviewLoginIdInvalidError
              | ReviewLoginStorageError
            > =>
              existing === null
                ? createReviewLogin(provisioning)
                : repairReviewLogin(provisioning, existing)
          )
        )
      )
    ),
    Effect.tapError((error) =>
      isAPIError(error)
        ? Effect.void
        : Effect.logWarning("Review login provisioning failed.", {
            code: "account.review-login.provisioning-failed",
          })
    ),
    Effect.withSpan("WorkspaceAuth.provisionReviewLogin")
  );
