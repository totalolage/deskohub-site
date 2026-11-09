import { Cause, Predicate } from "effect";
import { SqlError } from "effect/unstable/sql";

// Neon's proxy answers a connection to an endpoint that no longer exists, such
// as a deleted branch's, with this message under SQLSTATE XX000.
const neonEndpointNotFoundMessage = /requested endpoint could not be found/i;

const missingDatabaseCode = "3D000";

// Wrappers between a domain error and the driver error: domain error, Drizzle
// query error, Cause, SqlError. The bound only guards against cyclic causes.
const maxCauseDepth = 8;

const isUnavailableReason = (reason: SqlError.SqlErrorReason) => {
  // Effect SQL classifies every SQLSTATE class 28 failure as authentication.
  if (reason._tag === "AuthenticationError") return true;
  const driverError = reason.cause;
  return (
    (Predicate.hasProperty(driverError, "code") &&
      driverError.code === missingDatabaseCode) ||
    (Predicate.hasProperty(driverError, "message") &&
      Predicate.isString(driverError.message) &&
      neonEndpointNotFoundMessage.test(driverError.message))
  );
};

const findsUnavailableDatabase = (cause: unknown, depth: number): boolean => {
  if (depth > maxCauseDepth) return false;
  if (Cause.isCause(cause)) {
    return cause.reasons.some((reason) => {
      if (Cause.isFailReason(reason)) {
        return findsUnavailableDatabase(reason.error, depth + 1);
      }
      if (Cause.isDieReason(reason)) {
        return findsUnavailableDatabase(reason.defect, depth + 1);
      }
      return false;
    });
  }
  if (SqlError.isSqlError(cause)) return isUnavailableReason(cause.reason);
  return (
    Predicate.hasProperty(cause, "cause") &&
    findsUnavailableDatabase(cause.cause, depth + 1)
  );
};

/**
 * Whether a failure, or any error it wraps, shows that this deployment cannot
 * reach its database at all: rejected credentials (SQLSTATE class 28), a
 * missing database (3D000), or a Neon endpoint that no longer exists. A
 * Preview hits these once its Neon branch is deleted; in Production they are
 * an incident.
 */
export const isDatabaseUnavailable = (cause: unknown): boolean =>
  findsUnavailableDatabase(cause, 0);
