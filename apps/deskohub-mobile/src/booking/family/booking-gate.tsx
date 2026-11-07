import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import type { AccountNotice } from "../../account/account-gating";
import { reservationsAccess } from "../../account/account-gating";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { ListGroup, ListRow } from "../../ui/list";
import { Notice } from "../../ui/notice";

const unavailableNotice = (notice: AccountNotice, locale: AppLocale) =>
  ({
    "completion-required": m.account_notice_completion_required,
    "support-required": m.account_notice_support_required,
    unavailable: m.account_notice_unavailable,
    "deletion-pending": m.account_notice_deletion_pending,
  })[notice]({}, { locale });

/**
 * Shows `children` only to an account that can book, as the Reservations
 * tab gates its rows: an account without a profile is sent to complete it,
 * any other account sees why it can't book.
 */
export function BookingGate({ children }: { readonly children: ReactNode }) {
  const locale = useAppLocale();
  const router = useRouter();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  return (
    <AsyncView result={account} onRetry={refresh}>
      {(current) => {
        const access = reservationsAccess(current);
        return {
          available: () => children,
          "completion-required": () => (
            <>
              <Notice
                tone="info"
                message={m.booking_completion_required({}, { locale })}
              />
              <ListGroup>
                <ListRow
                  label={m.account_section_complete({}, { locale })}
                  onPress={() => router.push("/account/complete")}
                />
              </ListGroup>
            </>
          ),
          unavailable: () =>
            access.kind === "unavailable" && (
              <Notice
                tone="warning"
                message={unavailableNotice(access.notice, locale)}
              />
            ),
        }[access.kind]();
      }}
    </AsyncView>
  );
}
