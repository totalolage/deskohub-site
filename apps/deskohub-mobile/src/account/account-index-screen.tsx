import { useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useRouter } from "expo-router";
import { SignOutFailure, signOut } from "../auth/sign-out";
import { standaloneTaskRuntime, useAuthTask } from "../auth/use-auth-task";
import { AsyncView } from "../customer-api/async-view";
import { accountAtom } from "../customer-api/customer-data-runtime";
import type { AppLocale } from "../i18n/app-locale";
import { useAppLocale } from "../i18n/locale-context";
import { m } from "../i18n/messages";
import { LiveMessage } from "../ui/controls";
import { ListGroup, ListRow } from "../ui/list";
import { Notice } from "../ui/notice";
import { ScrollScreen } from "../ui/scroll-screen";
import {
  type AccountNotice,
  type AccountSection,
  accountIndexModel,
  accountSectionHref,
} from "./account-gating";
import { SignupReferralNotice } from "./profile/signup-referral-notice";

const runSignOut = () => signOut;
const unexpectedSignOutFailure = () => new SignOutFailure();

const sectionLabel = (section: AccountSection, locale: AppLocale) =>
  ({
    referrals: m.account_section_referrals,
    complete: m.account_section_complete,
    profile: m.account_section_profile,
    language: m.account_section_language,
    security: m.account_section_security,
    assistants: m.account_section_assistants,
    billing: m.account_section_billing,
    legal: m.account_section_legal,
    danger: m.account_section_danger,
  })[section]({}, { locale });

const noticeContent: Record<
  AccountNotice,
  {
    readonly tone: "info" | "warning";
    readonly message: (locale: AppLocale) => string;
  }
> = {
  "completion-required": {
    tone: "info",
    message: (locale) => m.account_notice_completion_required({}, { locale }),
  },
  "support-required": {
    tone: "warning",
    message: (locale) => m.account_notice_support_required({}, { locale }),
  },
  unavailable: {
    tone: "warning",
    message: (locale) => m.account_notice_unavailable({}, { locale }),
  },
  "deletion-pending": {
    tone: "info",
    message: (locale) => m.account_notice_deletion_pending({}, { locale }),
  },
};

/**
 * The Account tab: the account's sections in the site's order, gated by the
 * account's state (GET /account), then sign-out.
 */
export function AccountIndexScreen() {
  const locale = useAppLocale();
  const router = useRouter();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const signingOut = useAuthTask(
    standaloneTaskRuntime,
    runSignOut,
    unexpectedSignOutFailure
  );

  const notice = Option.getOrUndefined(
    Option.flatMapNullishOr(
      AsyncResult.value(account),
      (current) => accountIndexModel(current).notice
    )
  );

  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone={notice === undefined ? "info" : noticeContent[notice].tone}
        message={
          notice === undefined
            ? undefined
            : noticeContent[notice].message(locale)
        }
      />
      <AsyncView result={account} onRetry={refresh}>
        {(current) => (
          <>
            <SignupReferralNotice account={current} />
            <ListGroup>
              {accountIndexModel(current).sections.map((section) => (
                <ListRow
                  key={section}
                  label={sectionLabel(section, locale)}
                  destructive={section === "danger"}
                  onPress={() => router.push(accountSectionHref[section])}
                />
              ))}
            </ListGroup>
            <ListGroup>
              <ListRow
                label={m.account_signed_in_as(
                  { email: current.email },
                  { locale }
                )}
              />
            </ListGroup>
          </>
        )}
      </AsyncView>
      {/* Sign-out works even when the account couldn't be read. */}
      <ListGroup>
        <ListRow
          kind="action"
          label={m.account_sign_out({}, { locale })}
          disabled={signingOut.state.status === "running"}
          onPress={() => void signingOut.start()}
        />
      </ListGroup>
      <LiveMessage
        role="status"
        message={
          signingOut.state.status === "running"
            ? m.account_signing_out({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          signingOut.state.status === "failed"
            ? m.account_sign_out_failed({}, { locale })
            : undefined
        }
      />
      {__DEV__ && (
        <ListGroup>
          <ListRow
            label={m.account_dev_smoke_link({}, { locale })}
            onPress={() => router.push("/dev/effect-smoke")}
          />
        </ListGroup>
      )}
    </ScrollScreen>
  );
}
