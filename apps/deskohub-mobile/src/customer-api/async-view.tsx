import { Cause, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import type { ReactNode } from "react";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import {
  ErrorState,
  LoadingState,
  RefreshingIndicator,
} from "../ui/async-states";
import { Notice } from "../ui/notice";
import {
  type CustomerRequestFailure,
  type CustomerViewError,
  isRetryableViewError,
  toCustomerViewError,
} from "./customer-view-error";
import { sharedViewErrorMessage } from "./customer-view-error-message";

/** The view error of a failed result; a defect or interruption is unexpected. */
export const viewErrorOf = <E extends CustomerRequestFailure>(
  cause: Cause.Cause<E>
): CustomerViewError =>
  Option.match(Cause.findErrorOption(cause), {
    onNone: () => toCustomerViewError({ _tag: "SchemaError" } as never),
    onSome: toCustomerViewError,
  });

/**
 * Renders a screen's async data the same way everywhere: a spinner while it
 * first loads, the content (with a quiet refreshing line while it reloads),
 * and on failure the mapped message with "Try again" when retrying can help.
 * A failure after a success keeps the last content on screen under a notice.
 */
export function AsyncView<A, E extends CustomerRequestFailure>({
  result,
  onRetry,
  errorMessage,
  children,
}: {
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly onRetry: () => void;
  /** Copy for failures only this screen can explain. */
  readonly errorMessage?: (error: CustomerViewError) => string | undefined;
  readonly children: (value: A) => ReactNode;
}) {
  const locale = useAppLocale();
  if (AsyncResult.isInitial(result)) {
    return <LoadingState label={m.account_loading({}, { locale })} />;
  }
  const refreshing = (
    <RefreshingIndicator
      refreshing={result.waiting}
      label={m.account_refreshing({}, { locale })}
    />
  );
  if (AsyncResult.isSuccess(result)) {
    return (
      <>
        {refreshing}
        {children(result.value)}
      </>
    );
  }
  const error = viewErrorOf(result.cause);
  const message =
    errorMessage?.(error) ??
    sharedViewErrorMessage(error, locale) ??
    m.account_error_unexpected({}, { locale });
  const previous = AsyncResult.value(result);
  if (Option.isSome(previous)) {
    return (
      <>
        {refreshing}
        <Notice tone="error" message={message} />
        {children(previous.value)}
      </>
    );
  }
  return isRetryableViewError(error) ? (
    <ErrorState
      message={message}
      retryLabel={m.account_retry({}, { locale })}
      onRetry={onRetry}
      retrying={result.waiting}
    />
  ) : (
    <Notice tone="error" message={message} />
  );
}
