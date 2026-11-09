import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/unstable/reactivity";
import { StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import {
  copyReferralCodeAtom,
  type ReferralsView,
  referralsAtom,
  referralsFailure,
  referralsView,
  shareReferralLinkAtom,
} from "./referrals";

const failureMessage = (error: CustomerViewError, locale: AppLocale) => {
  const failure = referralsFailure(error);
  return failure === undefined
    ? undefined
    : {
        "not-released": m.referrals_not_released,
        "summary-unavailable": m.referrals_summary_unavailable,
      }[failure]({}, { locale });
};

/**
 * Referrals: who joined with the customer's referral, the discount it earns
 * and what it saved, with the code to copy and the link to share.
 */
export function ReferralsScreen() {
  const locale = useAppLocale();
  const referrals = useAtomValue(referralsAtom);
  const refresh = useAtomRefresh(referralsAtom);

  return (
    <ScrollScreen refreshing={referrals.waiting} onRefresh={refresh}>
      <AsyncView
        result={referrals}
        onRetry={refresh}
        errorMessage={(error) => failureMessage(error, locale)}
      >
        {(overview) => (
          <ReferralsSummary view={referralsView(overview, locale)} />
        )}
      </AsyncView>
    </ScrollScreen>
  );
}

function ReferralsSummary({ view }: { readonly view: ReferralsView }) {
  const locale = useAppLocale();
  const [copied, copy] = useAtom(copyReferralCodeAtom);
  const [shared, share] = useAtom(shareReferralLinkAtom);

  return (
    <>
      <ListGroup>
        <ListRow
          label={
            view.noInvitees
              ? m.referrals_count_empty({}, { locale })
              : m.referrals_count_summary(
                  {
                    eligible: String(view.eligibleInvitees),
                    total: String(view.invitees),
                  },
                  { locale }
                )
          }
          description={m.referrals_count_explanation({}, { locale })}
        />
      </ListGroup>
      <ListGroup>
        <ListRow
          label={m.referrals_discount_label({}, { locale })}
          value={view.discount}
          description={m.referrals_discount_explanation({}, { locale })}
        />
        <ListRow
          label={m.referrals_savings_label({}, { locale })}
          {...(view.savings.length === 0
            ? { description: m.referrals_savings_empty({}, { locale }) }
            : { value: view.savings.join(", ") })}
        />
      </ListGroup>
      <ListGroup>
        <ListRow label={m.referrals_program_explanation({}, { locale })} />
      </ListGroup>
      <SectionHeader title={m.referrals_code_label({}, { locale })} />
      <ListGroup>
        <View style={styles.code}>
          <Text selectable style={styles.codeText}>
            {view.code}
          </Text>
        </View>
        <ListRow
          kind="action"
          label={m.referrals_copy_code({}, { locale })}
          disabled={copied.waiting}
          onPress={() => copy(view.code)}
        />
      </ListGroup>
      <SectionHeader title={m.referrals_link_label({}, { locale })} />
      <ListGroup>
        <View style={styles.code}>
          <Text selectable style={styles.linkText}>
            {view.shareUrl}
          </Text>
        </View>
        <ListRow
          kind="action"
          label={m.referrals_share_link({}, { locale })}
          disabled={shared.waiting}
          onPress={() =>
            share({
              url: view.shareUrl,
              message: m.referrals_share_message(
                { code: view.code },
                { locale }
              ),
            })
          }
        />
      </ListGroup>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="status"
        message={
          AsyncResult.isSuccess(copied) && !copied.waiting
            ? m.referrals_code_copied({}, { locale })
            : undefined
        }
      />
      <LiveMessage
        role="alert"
        message={
          (AsyncResult.isFailure(copied) &&
            m.referrals_copy_failed({}, { locale })) ||
          (AsyncResult.isFailure(shared) &&
            m.referrals_share_failed({}, { locale })) ||
          undefined
        }
      />
    </>
  );
}

const styles = StyleSheet.create({
  code: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + theme.spacing.xs,
  },
  codeText: {
    color: theme.colors.accent,
    ...theme.type.heading,
    letterSpacing: 1,
  },
  linkText: { color: theme.colors.text, ...theme.type.caption },
});
