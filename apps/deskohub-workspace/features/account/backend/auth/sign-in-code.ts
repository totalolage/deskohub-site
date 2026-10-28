import type { AuthContext, DBAdapter } from "better-auth";
import { Clock, Data, Effect, Option } from "effect";
import type { SqlError } from "effect/unstable/sql";
import {
  betterAuthMagicLinkOptions,
  betterAuthSignInCodeOptions,
  digestVerificationKey,
  signInEmailLimit,
} from "./auth-options";

/**
 * The sign-in code rides in the same email as the magic link: one email is
 * one sign-in. Each email that carries a code gets a claim row keyed by its
 * link, and a binding row that leads from the code to that claim. The link
 * takes the claim before Better Auth consumes it, and the code takes it
 * before Better Auth creates the session, so only the first of the two
 * signs in. Codes are issued one email address at a time, and each issue
 * makes its own claim the address's current one. A code signs in only
 * through the current claim, so an older code that Better Auth still
 * accepts, such as one it wrote back after a wrong guess, cannot sign in.
 * Older links keep their own claims and still sign in once.
 */

/** The verification-table operations this module needs on its own rows. */
type VerificationRows = Pick<
  DBAdapter,
  "count" | "create" | "delete" | "deleteMany" | "findOne" | "updateMany"
>;

type StoredVerifications = Pick<
  AuthContext["internalAdapter"],
  "deleteVerificationByIdentifier"
>;

/**
 * Runs an effect while it holds one address's sign-in lock, named by
 * its `digestAddress`: a Workspace lock section in production.
 */
export type SignInEmailLock = <A, E>(
  address: string,
  effect: Effect.Effect<A, E>
) => Effect.Effect<A, E | SqlError.SqlError>;

/** A sign-in code or link row could not be read or written. */
class SignInCodeStorageError extends Data.TaggedError(
  "SignInCodeStorageError"
)<{ readonly code: "account.sign-in-code.storage" }> {
  constructor() {
    super({ code: "account.sign-in-code.storage" });
  }
}

/** The link sent with this code already signed in. */
class SignInEmailUsedError extends Data.TaggedError("SignInEmailUsedError")<
  Record<never, never>
> {}

const store = <A>(operation: () => Promise<A>) =>
  Effect.tryPromise({
    try: operation,
    catch: () => new SignInCodeStorageError(),
  });

const digest = (value: string) =>
  Effect.promise(() => digestVerificationKey(value));

/**
 * Better Auth lowercases the email in its OTP identifiers, while the
 * magic-link row keeps the address as typed.
 */
const normalizeEmail = (email: string) => email.trim().toLowerCase();

/** The email-OTP plugin's identifier for an email's sign-in code. */
const signInCodeIdentifier = (email: string) =>
  `sign-in-otp-${normalizeEmail(email)}`;

/**
 * The digest of a normalized address. It names the address's sign-in lock,
 * which serializes its sign-in writes: code issues and review-login
 * provisioning.
 */
export const digestAddress = ({ email }: { readonly email: string }) =>
  digest(normalizeEmail(email));

/** The claim row of the sign-in email that carried this link. */
const claimIdentifier = ({ token }: { readonly token: string }) =>
  digest(token).pipe(Effect.map((link) => `sign-in-claim-${link}`));

/** The row binding one code of one address to its email's claim. */
const codeBindingIdentifier = ({
  email,
  code,
}: {
  readonly email: string;
  readonly code: string;
}) =>
  digest(`${normalizeEmail(email)}:${code}`).pipe(
    Effect.map((binding) => `sign-in-code-${binding}`)
  );

/** The row naming the claim of the newest email sent to an address. */
const currentClaimIdentifier = (recipient: { readonly email: string }) =>
  digestAddress(recipient).pipe(
    Effect.map((address) => `sign-in-current-claim-${address}`)
  );

const openClaim = "open";
const takenClaim = "taken";

type SignInCodeIssue = {
  /** The sign-in email's address and its magic-link token. */
  readonly email: string;
  readonly token: string;
  readonly verifications: VerificationRows;
  readonly signInCodes: StoredVerifications;
  readonly createSignInCode: (email: string) => Promise<string>;
  readonly withSignInEmailLock: SignInEmailLock;
};

/**
 * Better Auth's `createVerificationOTP` only inserts, so the address's
 * earlier code is deleted first and only the newest email's code works.
 */
const replaceSignInCode = ({
  email,
  signInCodes,
  createSignInCode,
}: SignInCodeIssue) =>
  store(() =>
    signInCodes.deleteVerificationByIdentifier(signInCodeIdentifier(email))
  ).pipe(Effect.andThen(store(() => createSignInCode(normalizeEmail(email)))));

type ClaimRows = {
  readonly verifications: VerificationRows;
  readonly claim: string;
  readonly binding: string;
  readonly current: string;
};

/**
 * Retires the address's earlier current claim, and an earlier binding of the
 * same code, so each identifier leads to this email's claim alone.
 */
const retireEarlierClaim = ({ verifications, binding, current }: ClaimRows) =>
  store(() =>
    verifications.deleteMany({
      model: "verification",
      where: [
        { field: "identifier", operator: "in", value: [current, binding] },
      ],
    })
  );

const writeClaimRows = ({
  verifications,
  claim,
  binding,
  current,
}: ClaimRows) =>
  store(async () => {
    const now = Date.now();
    const rows = [
      { identifier: claim, value: openClaim },
      { identifier: binding, value: claim },
      { identifier: current, value: claim },
    ];
    for (const row of rows) {
      await verifications.create({
        model: "verification",
        data: {
          ...row,
          expiresAt: new Date(
            now + betterAuthMagicLinkOptions.expiresIn * 1000
          ),
          createdAt: new Date(now),
          updatedAt: new Date(now),
        },
      });
    }
  });

/**
 * Issues the code for a sign-in email, binds it to the email's claim, and
 * makes that claim the address's current one. Issues for one address run one
 * at a time, so the newest code is the only one stored and the current claim
 * is its email's.
 */
export const issueSignInCode = (issue: SignInCodeIssue) =>
  Effect.succeed(issue).pipe(
    Effect.bind("claim", claimIdentifier),
    Effect.bind("current", currentClaimIdentifier),
    Effect.bind("code", replaceSignInCode),
    Effect.bind("binding", ({ email, code }) =>
      codeBindingIdentifier({ email, code })
    ),
    Effect.tap(retireEarlierClaim),
    Effect.tap(writeClaimRows),
    Effect.map(({ code }) => code),
    (issuance) =>
      Effect.flatMap(digestAddress(issue), (address) =>
        issue.withSignInEmailLock(address, issuance)
      ),
    Effect.mapError(() => new SignInCodeStorageError()),
    Effect.withSpan("SignInCode.issue")
  );

type ClaimRequest = {
  readonly verifications: VerificationRows;
  readonly claim: string;
};

/** Takes the claim while it is still open. */
const takeOpenClaim = ({ verifications, claim }: ClaimRequest) =>
  store(() =>
    verifications.updateMany({
      model: "verification",
      where: [
        { field: "identifier", value: claim },
        { field: "value", value: openClaim },
      ],
      update: { value: takenClaim, updatedAt: new Date() },
    })
  ).pipe(
    Effect.map((taken) => (taken > 0 ? ("won" as const) : ("untaken" as const)))
  );

/**
 * A claim that was not open was taken first, unless the email carries no
 * code, as every email sent while sign-in codes are off.
 */
const settleUntakenClaim = ({ verifications, claim }: ClaimRequest) =>
  store(() =>
    verifications.findOne({
      model: "verification",
      where: [{ field: "identifier", value: claim }],
    })
  ).pipe(
    Effect.map((row) => (row ? ("lost" as const) : ("unclaimed" as const)))
  );

/** Takes an email's claim: `won`, `lost` to the other way in, or `unclaimed`. */
const takeClaim = (request: ClaimRequest) =>
  takeOpenClaim(request).pipe(
    Effect.filterOrElse(
      (outcome): outcome is "won" => outcome === "won",
      () => settleUntakenClaim(request)
    ),
    Effect.withSpan("SignInCode.takeClaim")
  );

/** Better Auth stores a link under the digest of its token. */
const revokeLink = ({
  token,
  signInLinks,
}: {
  readonly token: string;
  readonly signInLinks: StoredVerifications;
}) =>
  digest(token).pipe(
    Effect.flatMap((link) =>
      store(() => signInLinks.deleteVerificationByIdentifier(link))
    )
  );

/**
 * Runs before Better Auth consumes a magic link. When the code sent with the
 * link already signed in, the link is deleted, so Better Auth rejects it like
 * any used link.
 */
export const claimSignInLink = (request: {
  readonly token: string;
  readonly verifications: VerificationRows;
  readonly signInLinks: StoredVerifications;
}) =>
  Effect.succeed(request).pipe(
    Effect.bind("claim", claimIdentifier),
    Effect.bind("outcome", takeClaim),
    Effect.tap(({ outcome }) =>
      revokeLink(request).pipe(Effect.when(Effect.succeed(outcome === "lost")))
    ),
    Effect.asVoid,
    Effect.withSpan("SignInCode.claimLink")
  );

/** A row a code needs to sign in. Without it the code counts as used. */
const findCodeRow = (
  verifications: VerificationRows,
  where: Parameters<VerificationRows["findOne"]>[0]["where"]
) =>
  store(() =>
    verifications.findOne<{ readonly value: string }>({
      model: "verification",
      where,
    })
  ).pipe(
    Effect.flatMap(Effect.fromNullishOr),
    Effect.catchTag("NoSuchElementError", () =>
      Effect.fail(new SignInEmailUsedError())
    )
  );

/**
 * The claim a code's binding leads to. A code without one counts as used:
 * only an issue that never finished leaves one behind.
 */
const findBoundClaim = ({
  verifications,
  binding,
}: {
  readonly verifications: VerificationRows;
  readonly binding: string;
}) =>
  findCodeRow(verifications, [{ field: "identifier", value: binding }]).pipe(
    Effect.map(({ value }) => value)
  );

/** A code's claim must be its address's current one: a newer email ends it. */
const requireCurrentClaim = ({
  verifications,
  current,
  claim,
}: {
  readonly verifications: VerificationRows;
  readonly current: string;
  readonly claim: string;
}) =>
  findCodeRow(verifications, [
    { field: "identifier", value: current },
    { field: "value", value: claim },
  ]);

/**
 * Runs after Better Auth accepts a code and before it creates the session.
 * Fails when a newer email replaced the code or the email's link signed in
 * first.
 */
export const claimSignInCode = (request: {
  readonly email: string;
  readonly code: string;
  readonly verifications: VerificationRows;
}) =>
  Effect.succeed(request).pipe(
    Effect.bind("binding", codeBindingIdentifier),
    Effect.bind("current", currentClaimIdentifier),
    Effect.bind("claim", findBoundClaim),
    Effect.tap(requireCurrentClaim),
    Effect.bind("outcome", takeClaim),
    Effect.filterOrFail(
      ({ outcome }) => outcome === "won",
      () => new SignInEmailUsedError()
    ),
    Effect.asVoid,
    Effect.withSpan("SignInCode.claimCode")
  );

/**
 * Better Auth writes a code back after a wrong guess as a new row dated at
 * the write, and its verify reads the address's newest code row and deletes
 * the rest. An older code written back after a newer email would then
 * displace the newer code. A sign-in code row is dated at its issue instead,
 * which its expiry counts from, so the newest email's code stays the newest
 * row. Better Auth stores the row under the digest of its identifier.
 */
export const dateSignInCodeRow = ({
  email,
  row,
}: {
  readonly email: string;
  readonly row: { readonly identifier: string; readonly expiresAt: Date };
}) =>
  digest(signInCodeIdentifier(email)).pipe(
    Effect.map((identifier) =>
      Option.liftPredicate(row, (code) => code.identifier === identifier).pipe(
        Option.map(({ expiresAt }) => ({
          createdAt: new Date(
            expiresAt.getTime() - betterAuthSignInCodeOptions.expiresIn * 1000
          ),
        }))
      )
    ),
    Effect.withSpan("SignInCode.dateRow")
  );

type SignInEmailSend = {
  readonly verifications: VerificationRows;
  readonly identifier: string;
  readonly now: number;
};

/** The rows recording sign-in emails to one address. */
const sendRecordIdentifier = (recipient: { readonly email: string }) =>
  digestAddress(recipient).pipe(
    Effect.map((address) => `sign-in-email-${address}`)
  );

const recordSend = ({ verifications, identifier, now }: SignInEmailSend) =>
  store(() =>
    verifications.create<{ readonly id: string }>({
      model: "verification",
      data: {
        identifier,
        value: "sent",
        expiresAt: new Date(now + signInEmailLimit.window * 1000),
        createdAt: new Date(now),
        updatedAt: new Date(now),
      },
    })
  );

const countRecentSends = ({
  verifications,
  identifier,
  now,
}: SignInEmailSend) =>
  store(() =>
    verifications.count({
      model: "verification",
      where: [
        { field: "identifier", value: identifier },
        { field: "expiresAt", operator: "gt", value: new Date(now) },
      ],
    })
  );

/** A rejected send gives its row back, so it doesn't extend the window. */
const withdrawRejectedSend = ({
  verifications,
  record,
  admitted,
}: {
  readonly verifications: VerificationRows;
  readonly record: { readonly id: string };
  readonly admitted: boolean;
}) =>
  store(() =>
    verifications.delete({
      model: "verification",
      where: [{ field: "id", value: record.id }],
    })
  ).pipe(Effect.when(Effect.succeed(!admitted)));

/**
 * Records a sign-in email for the address unless it already received
 * `signInEmailLimit.max` within the rolling window. Each send is one
 * verification row keyed by a digest of the address, expiring with the
 * window, so the auth cleanup cron removes it. The row is written before
 * counting: concurrent sends can only under-admit, never exceed the limit.
 */
export const reserveSignInEmail = (request: {
  readonly verifications: VerificationRows;
  readonly email: string;
}) =>
  Effect.succeed(request).pipe(
    Effect.bind("identifier", sendRecordIdentifier),
    Effect.bind("now", () => Clock.currentTimeMillis),
    Effect.bind("record", recordSend),
    Effect.bind("sends", countRecentSends),
    Effect.let("admitted", ({ sends }) => sends <= signInEmailLimit.max),
    Effect.tap(withdrawRejectedSend),
    Effect.map(({ admitted }) => admitted),
    Effect.withSpan("SignInCode.reserveEmail")
  );
