import { Option } from "effect";
import type { ReactNode } from "react";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import {
  ErrorState,
  LoadingState,
  RefreshingIndicator,
} from "../../ui/async-states";
import { Button } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { bookingQueryMessage } from "./booking-family-copy";
import {
  type BookingRead,
  firstFailedRead,
  isRetryableBookingQueryError,
  readValue,
} from "./booking-family-view";

/**
 * A booking catalog read rendered as `AsyncView` renders account data,
 * with the booking failures worded too: a spinner first, the content (and
 * a quiet reloading line), a retry state for a first load that failed in a
 * way retrying can help, otherwise a notice above the last content.
 */
export function BookingReadView<A>({
  read,
  onRetry,
  children,
}: {
  readonly read: BookingRead<A>;
  readonly onRetry: () => void;
  readonly children: (value: A) => ReactNode;
}) {
  const locale = useAppLocale();
  const shown = readValue(read);
  const message =
    read.kind === "failed"
      ? bookingQueryMessage(read.error, locale)
      : undefined;
  const retryState =
    read.kind === "failed" &&
    Option.isNone(shown) &&
    isRetryableBookingQueryError(read.error);
  return (
    <>
      <RefreshingIndicator
        refreshing={read.kind === "loaded" && read.refreshing}
        label={m.account_refreshing({}, { locale })}
      />
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="error" message={retryState ? undefined : message} />
      {read.kind === "loading" && (
        <LoadingState label={m.account_loading({}, { locale })} />
      )}
      {retryState && (
        <ErrorState
          message={message ?? ""}
          retryLabel={m.account_retry({}, { locale })}
          onRetry={onRetry}
          retrying={read.retrying}
        />
      )}
      {Option.isSome(shown) && children(shown.value)}
    </>
  );
}

/**
 * The first failed read among a screen's supporting reads (availability,
 * free starts), worded, with "Try again" when retrying can help.
 */
export function BookingReadFailure({
  reads,
  onRetry,
}: {
  readonly reads: ReadonlyArray<BookingRead<unknown>>;
  readonly onRetry: () => void;
}) {
  const locale = useAppLocale();
  const failed = firstFailedRead(reads);
  return (
    <>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone="error"
        message={
          failed === undefined
            ? undefined
            : bookingQueryMessage(failed.error, locale)
        }
      />
      {failed !== undefined && isRetryableBookingQueryError(failed.error) && (
        <Button
          variant="secondary"
          label={m.account_retry({}, { locale })}
          disabled={failed.retrying}
          onPress={onRetry}
        />
      )}
    </>
  );
}
