import {
  RegistryContext,
  useAtom,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { Effect, Match, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { openBrowserAsync } from "expo-web-browser";
import { useContext, useEffect, useState } from "react";
import { StyleSheet, Switch, View } from "react-native";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { appForegroundAtom } from "../../platform/app-foreground";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import {
  type AnalyticsSaveFeedback,
  analyticsPreferenceAtom,
  analyticsSwitchView,
  followAnalyticsPreference,
  isAnalyticsPreferenceUnavailable,
  saveAnalyticsPreferenceAtom,
} from "./analytics-preference";
import {
  type LegalDocument,
  legalDocuments,
  legalDocumentUrl,
} from "./legal-documents";
import {
  isMarketingPreferenceUnavailable,
  type MarketingSaveFeedback,
  marketingPreferencesAtom,
  marketingSwitchView,
  saveMarketingPreferenceAtom,
} from "./marketing-preferences";
import type { PreferenceSwitchState } from "./preference-switch";

const documentLabel = (document: LegalDocument, locale: AppLocale) =>
  ({
    privacy: m.legal_document_privacy,
    marketing: m.legal_document_marketing,
    terms: m.legal_document_terms,
    cookies: m.legal_document_cookies,
  })[document]({}, { locale });

// Opens a document in the in-app browser; it fails where no browser is
// available.
const openDocumentAtom = Atom.fn((url: string) =>
  Effect.tryPromise(() => openBrowserAsync(url))
);

/**
 * Legal & Privacy: the site's legal documents (opened in the in-app
 * browser), a linked account's marketing consent, the signed-in account's
 * analytics preference, and the data archive the account doesn't offer yet.
 * The analytics preference is the account's, whatever its profile's state,
 * as on the site; the app's own analytics answer comes from its consent
 * prompt and follows the account's decisions. The other cookie
 * categories are a website setting the app doesn't manage; the cookie policy
 * describes them.
 */
export function LegalScreen() {
  const locale = useAppLocale();
  const account = useAtomValue(accountAtom);
  const refreshAccount = useAtomRefresh(accountAtom);
  const registry = useContext(RegistryContext);
  const [opened, openDocument] = useAtom(openDocumentAtom);
  const linked = Option.exists(
    AsyncResult.value(account),
    (current) => current.kind === "linked"
  );
  // Only a linked account's screen shows (and so reads) marketing consent.
  const refresh = () => {
    refreshAccount();
    registry.refresh(analyticsPreferenceAtom);
    if (linked) registry.refresh(marketingPreferencesAtom);
  };
  const openPrivacyPolicy = () =>
    openDocument(legalDocumentUrl("privacy", apiOrigin));

  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      <SectionHeader title={m.legal_documents_heading({}, { locale })} />
      <ListGroup>
        {legalDocuments.map((document) => (
          <ListRow
            key={document}
            label={documentLabel(document, locale)}
            description={m.legal_document_opens_in_browser({}, { locale })}
            onPress={() => openDocument(legalDocumentUrl(document, apiOrigin))}
          />
        ))}
      </ListGroup>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="alert"
        message={
          AsyncResult.isFailure(opened)
            ? m.legal_document_open_failed({}, { locale })
            : undefined
        }
      />
      <SectionHeader title={m.legal_marketing_heading({}, { locale })} />
      <AsyncView result={account} onRetry={refreshAccount}>
        {(current) =>
          current.kind === "linked" ? (
            <MarketingPreference />
          ) : (
            <ListGroup>
              <ListRow label={m.legal_marketing_unavailable({}, { locale })} />
            </ListGroup>
          )
        }
      </AsyncView>
      <SectionHeader title={m.legal_analytics_heading({}, { locale })} />
      <AnalyticsPreference onOpenPrivacyPolicy={openPrivacyPolicy} />
      <SectionHeader title={m.legal_archive_heading({}, { locale })} />
      <ListGroup>
        <ListRow label={m.legal_archive_unavailable({}, { locale })} />
      </ListGroup>
    </ScrollScreen>
  );
}

const feedbackMessage = (
  feedback: MarketingSaveFeedback,
  locale: AppLocale
): { readonly role: "status" | "alert"; readonly message: string } =>
  Match.value(feedback).pipe(
    Match.discriminatorsExhaustive("kind")({
      saving: () => ({
        role: "status" as const,
        message: m.legal_marketing_saving({}, { locale }),
      }),
      saved: () => ({
        role: "status" as const,
        message: m.legal_marketing_saved({}, { locale }),
      }),
      stale: () => ({
        role: "alert" as const,
        message: m.legal_marketing_stale({}, { locale }),
      }),
      unconfirmed: () => ({
        role: "alert" as const,
        message: m.account_save_unconfirmed({}, { locale }),
      }),
      // An unexpected failure gets this screen's own sentence.
      failed: ({ error }) => ({
        role: "alert" as const,
        message:
          (error._tag === "Unexpected"
            ? undefined
            : sharedViewErrorMessage(error, locale)) ??
          m.legal_marketing_save_failed({}, { locale }),
      }),
    })
  );

/** The linked account's marketing consent switch. */
function MarketingPreference() {
  const locale = useAppLocale();
  const preferences = useAtomValue(marketingPreferencesAtom);
  const refresh = useAtomRefresh(marketingPreferencesAtom);
  const [save, choose] = useAtom(saveMarketingPreferenceAtom);
  const [requested, setRequested] = useState<boolean>();

  const view = marketingSwitchView({ preferences, save, requested });
  const feedback =
    view.feedback === undefined
      ? undefined
      : feedbackMessage(view.feedback, locale);

  return (
    <>
      <AsyncView
        result={preferences}
        onRetry={refresh}
        errorMessage={(error) =>
          isMarketingPreferenceUnavailable(error)
            ? m.legal_marketing_unavailable({}, { locale })
            : undefined
        }
      >
        {(current) => (
          <ListGroup>
            <PreferenceSwitch
              label={m.legal_marketing_switch_label({}, { locale })}
              description={m.legal_marketing_description({}, { locale })}
              view={view}
              onChange={(granted) => {
                setRequested(granted);
                choose({ context: current.context, granted, locale });
              }}
            />
          </ListGroup>
        )}
      </AsyncView>
      <FeedbackMessages feedback={feedback} />
    </>
  );
}

const analyticsFeedbackMessage = (
  feedback: AnalyticsSaveFeedback,
  locale: AppLocale
): { readonly role: "status" | "alert"; readonly message: string } =>
  Match.value(feedback).pipe(
    Match.discriminatorsExhaustive("kind")({
      saving: () => ({
        role: "status" as const,
        message: m.legal_analytics_saving({}, { locale }),
      }),
      saved: () => ({
        role: "status" as const,
        message: m.legal_analytics_saved({}, { locale }),
      }),
      unconfirmed: () => ({
        role: "alert" as const,
        message: m.account_save_unconfirmed({}, { locale }),
      }),
      failed: ({ error }) => ({
        role: "alert" as const,
        message:
          (error._tag === "Unexpected"
            ? undefined
            : sharedViewErrorMessage(error, locale)) ??
          m.legal_analytics_save_failed({}, { locale }),
      }),
    })
  );

/**
 * The signed-in account's analytics preference switch, read again on each
 * return to the foreground. A saved choice also becomes this device's
 * analytics answer. While the preference can't be
 * read there is no switch, so it never reads as off.
 */
function AnalyticsPreference({
  onOpenPrivacyPolicy,
}: {
  readonly onOpenPrivacyPolicy: () => void;
}) {
  const locale = useAppLocale();
  const registry = useContext(RegistryContext);
  const preference = useAtomValue(analyticsPreferenceAtom);
  const refresh = useAtomRefresh(analyticsPreferenceAtom);
  useEffect(
    () =>
      followAnalyticsPreference({ registry, foreground: appForegroundAtom }),
    [registry]
  );
  const [save, choose] = useAtom(saveAnalyticsPreferenceAtom);
  const [requested, setRequested] = useState<boolean>();

  const view = analyticsSwitchView({ preference, save, requested });
  const feedback =
    view.feedback === undefined
      ? undefined
      : analyticsFeedbackMessage(view.feedback, locale);

  return (
    <>
      <AsyncView
        result={preference}
        onRetry={refresh}
        errorMessage={(error) =>
          isAnalyticsPreferenceUnavailable(error)
            ? m.legal_analytics_unavailable({}, { locale })
            : undefined
        }
      >
        {() => (
          <ListGroup>
            <PreferenceSwitch
              label={m.legal_analytics_switch_label({}, { locale })}
              description={m.legal_analytics_description({}, { locale })}
              view={view}
              onChange={(granted) => {
                setRequested(granted);
                choose({ granted, locale });
              }}
            />
            <ListRow
              label={m.legal_document_privacy({}, { locale })}
              description={m.legal_document_opens_in_browser({}, { locale })}
              onPress={onOpenPrivacyPolicy}
            />
          </ListGroup>
        )}
      </AsyncView>
      <FeedbackMessages feedback={feedback} />
    </>
  );
}

/** A switch row over a saved account preference. */
function PreferenceSwitch({
  label,
  description,
  view,
  onChange,
}: {
  readonly label: string;
  readonly description: string;
  readonly view: PreferenceSwitchState;
  readonly onChange: (granted: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <View style={styles.switchText}>
        <Text style={styles.switchLabel}>{label}</Text>
        <Text style={styles.switchDescription}>{description}</Text>
      </View>
      <Switch
        aria-label={label}
        accessibilityHint={description}
        value={view.granted}
        disabled={!view.enabled}
        aria-disabled={!view.enabled}
        trackColor={{
          false: theme.colors.border,
          true: theme.colors.accent,
        }}
        thumbColor={theme.colors.text}
        onValueChange={onChange}
      />
    </View>
  );
}

/** A preference save's feedback, kept mounted so assistive tech announces each change. */
function FeedbackMessages({
  feedback,
}: {
  readonly feedback:
    | { readonly role: "status" | "alert"; readonly message: string }
    | undefined;
}) {
  return (
    <>
      <LiveMessage
        role="status"
        message={feedback?.role === "status" ? feedback.message : undefined}
      />
      <LiveMessage
        role="alert"
        message={feedback?.role === "alert" ? feedback.message : undefined}
      />
    </>
  );
}

const styles = StyleSheet.create({
  switchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.md,
    minHeight: theme.touchTarget + theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + theme.spacing.xs,
  },
  switchText: { flex: 1, gap: theme.spacing.xs },
  switchLabel: { color: theme.colors.text, ...theme.type.body },
  switchDescription: { color: theme.colors.textMuted, ...theme.type.caption },
});
