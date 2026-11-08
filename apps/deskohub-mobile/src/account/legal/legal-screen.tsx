import {
  RegistryContext,
  useAtom,
  useAtomRefresh,
  useAtomValue,
} from "@effect/atom-react";
import { Effect, Match, Option } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";
import { openBrowserAsync } from "expo-web-browser";
import { useContext, useState } from "react";
import { StyleSheet, Switch, Text, View } from "react-native";
import { apiOrigin } from "../../auth/auth-client";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import { sharedViewErrorMessage } from "../../customer-api/customer-view-error-message";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  type LegalDocument,
  legalDocuments,
  legalDocumentUrl,
} from "./legal-documents";
import {
  type MarketingSaveFeedback,
  marketingPreferencesAtom,
  marketingSwitchView,
  saveMarketingPreferenceAtom,
} from "./marketing-preferences";

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
 * browser), the marketing consent of a linked account, and the data archive
 * the account doesn't offer yet. Cookie categories are a website setting the
 * app doesn't manage; the cookie policy describes them.
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
  // Only a linked account's screen shows (and so reads) the preference.
  const refresh = () => {
    refreshAccount();
    if (linked) registry.refresh(marketingPreferencesAtom);
  };

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
      <AsyncView result={preferences} onRetry={refresh}>
        {(current) => (
          <ListGroup>
            <View style={styles.switchRow}>
              <View style={styles.switchText}>
                <Text style={styles.switchLabel}>
                  {m.legal_marketing_switch_label({}, { locale })}
                </Text>
                <Text style={styles.switchDescription}>
                  {m.legal_marketing_description({}, { locale })}
                </Text>
              </View>
              <Switch
                aria-label={m.legal_marketing_switch_label({}, { locale })}
                accessibilityHint={m.legal_marketing_description(
                  {},
                  { locale }
                )}
                value={view.granted}
                disabled={!view.enabled}
                aria-disabled={!view.enabled}
                trackColor={{
                  false: theme.colors.border,
                  true: theme.colors.accent,
                }}
                thumbColor={theme.colors.text}
                onValueChange={(granted) => {
                  setRequested(granted);
                  choose({ context: current.context, granted, locale });
                }}
              />
            </View>
          </ListGroup>
        )}
      </AsyncView>
      {/* Kept mounted so assistive tech announces each change. */}
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
