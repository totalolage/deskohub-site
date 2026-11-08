import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import type { CustomerViewError } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { ConfirmDialog } from "../../ui/confirm-dialog";
import { BodyText, Button, LiveMessage } from "../../ui/controls";
import { ListGroup, ListRow } from "../../ui/list";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import {
  type AssistantRow,
  type AssistantScope,
  assistantConnectionsAtom,
  assistantRows,
  type DisconnectTarget,
  disconnectAssistantAtom,
  disconnectedAssistantsAtom,
  disconnectView,
  isAssistantsUnavailable,
} from "./connected-assistants";

const scopeLabel = (scope: AssistantScope, locale: AppLocale) =>
  ({
    "offerings:read": m.assistants_scope_offerings_read,
    "reservations:read": m.assistants_scope_reservations_read,
    "reservations:create": m.assistants_scope_reservations_create,
    offline_access: m.assistants_scope_offline_access,
  })[scope]({}, { locale });

const detailsText = (row: AssistantRow, locale: AppLocale) => {
  const { details } = row;
  switch (details.kind) {
    case "host":
      return m.assistants_details(
        { host: details.host, date: details.date },
        { locale }
      );
    case "date":
      return m.assistants_connected_on({ date: details.date }, { locale });
    case "none":
      return undefined;
  }
};

// The list couldn't be read: the screen says so in its own words.
const listErrorMessage = (locale: AppLocale) => (error: CustomerViewError) =>
  isAssistantsUnavailable(error)
    ? m.assistants_unavailable({}, { locale })
    : undefined;

/**
 * Connected assistants: the AI assistants the customer let use their
 * account, what each may do, and a way to disconnect one. It needs only the
 * session, so it works without a linked Dotypos profile.
 */
export function AssistantsScreen() {
  const locale = useAppLocale();
  const connections = useAtomValue(assistantConnectionsAtom);
  const refresh = useAtomRefresh(assistantConnectionsAtom);
  const disconnected = useAtomValue(disconnectedAssistantsAtom);
  const [result, disconnect] = useAtom(disconnectAssistantAtom);
  const [target, setTarget] = useState<DisconnectTarget>();

  const view = disconnectView({ target, result });
  const targetName = target?.name ?? m.assistants_unnamed({}, { locale });

  const ask = (next: DisconnectTarget) => {
    // A new confirmation starts without the last attempt's outcome.
    disconnect(Atom.Reset);
    setTarget(next);
  };

  return (
    <ScrollScreen refreshing={connections.waiting} onRefresh={refresh}>
      <BodyText>{m.assistants_intro({}, { locale })}</BodyText>
      {/* Kept mounted so assistive tech announces each change. */}
      <LiveMessage
        role="status"
        message={
          view.outcome === "disconnected"
            ? m.assistants_disconnected({}, { locale })
            : undefined
        }
      />
      <Notice
        tone="error"
        message={
          view.outcome === "unconfirmed"
            ? m.account_save_unconfirmed({}, { locale })
            : undefined
        }
      />
      <AsyncView
        result={connections}
        onRetry={refresh}
        errorMessage={listErrorMessage(locale)}
      >
        {(current) => {
          const rows = assistantRows(current, disconnected, locale);
          return rows.length === 0 ? (
            <ListGroup>
              <ListRow
                label={m.assistants_empty_title({}, { locale })}
                description={m.assistants_empty_body({}, { locale })}
              />
            </ListGroup>
          ) : (
            <ListGroup>
              {rows.map((row) => (
                <AssistantConnectionRow
                  key={row.id}
                  row={row}
                  locale={locale}
                  onDisconnect={() => ask({ id: row.id, name: row.name })}
                />
              ))}
            </ListGroup>
          );
        }}
      </AsyncView>
      <ConfirmDialog
        visible={view.dialogOpen}
        title={m.assistants_disconnect_title({ name: targetName }, { locale })}
        body={m.assistants_disconnect_body({}, { locale })}
        confirmLabel={m.assistants_disconnect_confirm({}, { locale })}
        cancelLabel={m.account_cancel({}, { locale })}
        destructive
        busy={view.busy}
        busyMessage={m.assistants_disconnecting({}, { locale })}
        onConfirm={() => {
          if (target !== undefined) disconnect(target.id);
        }}
        onCancel={() => setTarget(undefined)}
      >
        <LiveMessage
          role="alert"
          message={
            view.failed
              ? m.assistants_disconnect_failed({}, { locale })
              : undefined
          }
        />
      </ConfirmDialog>
    </ScrollScreen>
  );
}

/** One connected assistant: who it is, what it may do, and Disconnect. */
export function AssistantConnectionRow({
  row,
  locale,
  onDisconnect,
}: {
  readonly row: AssistantRow;
  readonly locale: AppLocale;
  readonly onDisconnect: () => void;
}) {
  const name = row.name ?? m.assistants_unnamed({}, { locale });
  const details = detailsText(row, locale);
  return (
    <View style={styles.row}>
      <View style={styles.header}>
        <View style={styles.identity}>
          <Text role="heading" aria-level={3} style={styles.name}>
            {name}
          </Text>
          {details !== undefined && (
            <Text style={styles.details}>{details}</Text>
          )}
        </View>
        <View style={styles.disconnect}>
          <Button
            variant="secondary"
            label={m.assistants_disconnect({}, { locale })}
            accessibilityLabel={m.assistants_disconnect_label(
              { name },
              { locale }
            )}
            onPress={onDisconnect}
          />
        </View>
      </View>
      {(row.scopes.length > 0 || row.administration) && (
        <View
          role="list"
          aria-label={m.assistants_scopes_label({ name }, { locale })}
          style={styles.scopes}
        >
          {row.scopes.map((scope) => (
            <View key={scope} role="listitem" style={styles.scope}>
              <Text aria-hidden style={styles.granted}>
                ✓
              </Text>
              <Text style={styles.scopeLabel}>{scopeLabel(scope, locale)}</Text>
            </View>
          ))}
          {row.administration && (
            <View role="listitem" style={styles.scope}>
              <Text aria-hidden style={styles.administration}>
                !
              </Text>
              <Text style={[styles.scopeLabel, styles.administration]}>
                {m.assistants_administration({}, { locale })}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + theme.spacing.xs,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  identity: { flex: 1, gap: 2 },
  name: { color: theme.colors.text, ...theme.type.body, fontWeight: "600" },
  details: { color: theme.colors.textMuted, ...theme.type.caption },
  disconnect: { flexShrink: 0 },
  scopes: { gap: theme.spacing.xs },
  scope: { flexDirection: "row", gap: theme.spacing.sm },
  granted: { color: theme.colors.accent, ...theme.type.caption },
  scopeLabel: { color: theme.colors.text, flex: 1, ...theme.type.caption },
  administration: { color: theme.colors.warning, fontWeight: "600" },
});
