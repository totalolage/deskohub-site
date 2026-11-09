import { Option } from "effect";
import { useAppLocale } from "../../i18n/locale-context";
import { Notice } from "../../ui/notice";
import type { CheckoutRestartReason } from "../checkout/booking-problem";
import { restartMessage } from "./booking-family-copy";

/**
 * Why checkout started the booking over, at the top of a family screen. It
 * stays mounted while there's no reason, so each one is announced.
 */
export function RestartNotice({
  reason,
}: {
  readonly reason: Option.Option<CheckoutRestartReason>;
}) {
  const locale = useAppLocale();
  return (
    <Notice
      tone="info"
      message={Option.getOrUndefined(
        Option.map(reason, (restart) => restartMessage(restart, locale))
      )}
    />
  );
}
