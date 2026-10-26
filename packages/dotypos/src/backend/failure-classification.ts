import { Match } from "effect";
import {
  type DotyposOperation,
  DotyposRejected,
  type DotyposRequest,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
} from "../errors";
import type { DotyposWireFailure } from "./api";
import {
  type DotyposAttemptFailure,
  type DotyposRequestFailure,
  dotyposRequestProfiles,
} from "./request-profiles";

/** The public operation a caller invoked and the wire request it was making. */
export type DotyposCall<Request extends DotyposRequest = DotyposRequest> = {
  readonly operation: DotyposOperation;
  readonly request: Request;
};

type DotyposFailureFields = {
  readonly operation: DotyposOperation;
  readonly request?: DotyposRequest;
  readonly httpStatus?: number;
  readonly message?: string;
  readonly cause?: unknown;
};

/** Which column of the classification table a request uses. */
type DotyposRequestKind = "read" | "write" | "conditional";

const requestKind = (request: DotyposRequest): DotyposRequestKind => {
  const profile = dotyposRequestProfiles[request];
  if (profile.effect === "read") return "read";
  return profile.repeat === "conditional" ? "conditional" : "write";
};

const connectionFailedMessage = "Failed to connect to Dotypos";

/**
 * Classifies one failed attempt of a request into a public outcome by the
 * request's kind. A write that failed after it may have been sent is
 * uncertain; an access-token failure happens before the request is sent, so
 * it never is.
 */
export const classifyWireFailure = <Request extends DotyposRequest>(
  failure: DotyposWireFailure,
  call: DotyposCall<Request>
): DotyposRequestFailure<Request> => {
  const fields: DotyposFailureFields = {
    operation: call.operation,
    request: call.request,
    ...(failure.cause !== undefined && { cause: failure.cause }),
  };
  const kind = failure.fromAccessToken ? "read" : requestKind(call.request);
  const outcome: DotyposAttemptFailure = Match.value(failure.outcome).pipe(
    Match.discriminatorsExhaustive("kind")({
      status: ({ status }) =>
        failure.fromAccessToken
          ? classifyAccessTokenStatus(status, fields)
          : classifyStatus(status, kind, fields),
      transport: () =>
        unavailableOrUncertain(kind, "transport", {
          ...fields,
          message: connectionFailedMessage,
        }),
      unreadable: () => rejectedOrUncertain(kind, fields),
    })
  );
  return outcome as DotyposRequestFailure<Request>;
};

const classifyStatus = (
  status: number,
  kind: DotyposRequestKind,
  base: DotyposFailureFields
): DotyposAttemptFailure => {
  const fields = {
    ...base,
    httpStatus: status,
    message: "Dotypos API request failed",
  };
  if (status < 400) return rejectedOrUncertain(kind, fields);
  if (status === 401 || status === 403) {
    return new DotyposRejected({ ...fields, reason: "unauthorized" });
  }
  if (status === 404) {
    return new DotyposRejected({ ...fields, reason: "not-found" });
  }
  if ((status === 409 || status === 412) && kind === "conditional") {
    return new DotyposVersionConflict(fields);
  }
  if (status === 429) {
    return new DotyposUnavailable({ ...fields, reason: "rate-limited" });
  }
  if (status >= 500) return unavailableOrUncertain(kind, "server", fields);
  return new DotyposRejected({ ...fields, reason: "invalid-request" });
};

/** The token request runs before the addressed request, so nothing was applied. */
const classifyAccessTokenStatus = (
  status: number,
  base: DotyposFailureFields
): DotyposAttemptFailure => {
  const fields = {
    ...base,
    httpStatus: status,
    message: "Dotypos access token request failed",
  };
  if (status < 400) {
    return new DotyposRejected({ ...fields, reason: "invalid-response" });
  }
  if (status === 429) {
    return new DotyposUnavailable({ ...fields, reason: "rate-limited" });
  }
  if (status >= 500) {
    return new DotyposUnavailable({ ...fields, reason: "server" });
  }
  return new DotyposRejected({ ...fields, reason: "unauthorized" });
};

const unavailableOrUncertain = (
  kind: DotyposRequestKind,
  reason: "server" | "transport" | "timeout",
  fields: DotyposFailureFields
) =>
  kind === "read"
    ? new DotyposUnavailable({ ...fields, reason })
    : new DotyposUncertain({ ...fields, reason });

const rejectedOrUncertain = (
  kind: DotyposRequestKind,
  fields: DotyposFailureFields
) =>
  kind === "read"
    ? new DotyposRejected({ ...fields, reason: "invalid-response" })
    : new DotyposUncertain({ ...fields, reason: "invalid-response" });

/** The per-request timeout fired. A write may already have been sent. */
export const dotyposTimeout = <Request extends DotyposRequest>(
  call: DotyposCall<Request>
): DotyposRequestFailure<Request> =>
  unavailableOrUncertain(requestKind(call.request), "timeout", {
    ...call,
    message: connectionFailedMessage,
  }) as DotyposRequestFailure<Request>;

/**
 * Dotypos answered 2xx with a body the package cannot use. `httpStatus` is set
 * only where the failure carried a status before the outcome tags.
 */
export const dotyposInvalidResponse = <Request extends DotyposRequest>(
  call: DotyposCall<Request>,
  details: {
    readonly message: string;
    readonly httpStatus?: number;
    readonly cause?: unknown;
  }
): DotyposRequestFailure<Request> =>
  rejectedOrUncertain(requestKind(call.request), {
    ...call,
    ...details,
  }) as DotyposRequestFailure<Request>;

/** The caller's input is invalid, so no request was sent. */
export const dotyposInvalidRequest = (
  operation: DotyposOperation,
  message: string,
  cause?: unknown
) =>
  new DotyposRejected({
    operation,
    reason: "invalid-request",
    message,
    ...(cause !== undefined && { cause }),
  });
