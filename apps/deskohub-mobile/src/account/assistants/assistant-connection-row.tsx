import { StyleSheet, View } from "react-native";
import type { AppLocale } from "../../i18n/app-locale";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { Button } from "../../ui/controls";
import { Text } from "../../ui/text";
import type { AssistantRow, AssistantScope } from "./connected-assistants";

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
  // With large text the button wraps below the name instead of squeezing it.
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  identity: { flexBasis: 180, flexGrow: 1, flexShrink: 1, gap: 2 },
  name: { color: theme.colors.text, ...theme.type.body, fontWeight: "600" },
  details: { color: theme.colors.textMuted, ...theme.type.caption },
  disconnect: { flexGrow: 0, maxWidth: "100%" },
  scopes: { gap: theme.spacing.xs },
  scope: { flexDirection: "row", gap: theme.spacing.sm },
  granted: { color: theme.colors.accent, ...theme.type.caption },
  scopeLabel: { color: theme.colors.text, flex: 1, ...theme.type.caption },
  administration: { color: theme.colors.warning, fontWeight: "600" },
});
