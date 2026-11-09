import { Option } from "effect";
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
  viewErrorOf,
} from "./customer-view-error";
import { sharedViewErrorMessage } from "./customer-view-error-message";

export { viewErrorOf } from "./customer-view-error";

/**
 * Renders a screen's async data the same way everywhere: a spinner (or the
 * screen's own `loading` content) while it first loads, the content (with a
 * quiet refreshing line while it reloads), and on failure the mapped message with "Try again" when retrying can help.
 * A failure after a success keeps the last content on screen under a notice.
 */
export function AsyncView<A, E extends CustomerRequestFailure>({
  result,
  onRetry,
  errorMessage,
  loading,
  children,
}: {
  readonly result: AsyncResult.AsyncResult<A, E>;
  readonly onRetry: () => void;
  /** Copy for failures only this screen can explain. */
  readonly errorMessage?: (error: CustomerViewError) => string | undefined;
  /** Shown instead of the spinner while the first load is under way. */
  readonly loading?: ReactNode;
  readonly children: (value: A) => ReactNode;
}) {
  const locale = useAppLocale();
  const failure = AsyncResult.isFailure(result)
    ? viewErrorOf(result.cause)
    : undefined;
  const message =
    failure === undefined
      ? undefined
      : (errorMessage?.(failure) ??
        sharedViewErrorMessage(failure, locale) ??
        m.account_error_unexpected({}, { locale }));
  const shown = AsyncResult.value(result);
  // A first load that failed in a way retrying can help gets the full retry
  // state; any other failure is a notice above whatever is on screen.
  const retryState =
    failure !== undefined &&
    Option.isNone(shown) &&
    isRetryableViewError(failure);
  return (
    <>
      <RefreshingIndicator
        refreshing={!AsyncResult.isInitial(result) && result.waiting}
        label={m.account_refreshing({}, { locale })}
      />
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="error" message={retryState ? undefined : message} />
      {AsyncResult.isInitial(result) &&
        (loading ?? <LoadingState label={m.account_loading({}, { locale })} />)}
      {retryState && (
        <ErrorState
          message={message ?? ""}
          retryLabel={m.account_retry({}, { locale })}
          onRetry={onRetry}
          retrying={result.waiting}
        />
      )}
      {Option.isSome(shown) && children(shown.value)}
    </>
  );
}
