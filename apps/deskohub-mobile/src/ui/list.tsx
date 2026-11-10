import { Children, Fragment, isValidElement, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { theme } from "../theme";
import {
  type ListRowKind,
  listRowAccessibleLabel,
  listRowPresentation,
} from "./list-row-presentation";
import { Text } from "./text";

/** The heading above a group of rows. */
export function SectionHeader({ title }: { readonly title: string }) {
  return (
    <Text role="heading" aria-level={2} style={styles.sectionHeader}>
      {title}
    </Text>
  );
}

/** Rows on one raised surface, separated by hairlines. */
export function ListGroup({ children }: { readonly children: ReactNode }) {
  // `Children.toArray` keys every row and drops `false` from conditional rows.
  const rows = Children.toArray(children).filter(isValidElement);
  return (
    <View style={styles.group}>
      {rows.map((row, index) => (
        <Fragment key={row.key}>
          {index > 0 && <View style={styles.separator} />}
          {row}
        </Fragment>
      ))}
    </View>
  );
}

/**
 * One row of a list. Without `onPress` it only shows content. A `navigation`
 * row (the default) is a link with a chevron that opens another screen; an
 * `action` row is a button that acts in place. `destructive` marks an
 * irreversible action, such as deleting the account. `wrapValue` lets a long
 * value, such as a date range, take more room and wrap instead of being cut.
 */
export function ListRow({
  label,
  description,
  value,
  onPress,
  kind = "navigation",
  destructive = false,
  disabled = false,
  wrapValue = false,
}: {
  readonly label: string;
  readonly description?: string;
  readonly value?: string;
  readonly onPress?: () => void;
  readonly kind?: ListRowKind;
  readonly destructive?: boolean;
  readonly disabled?: boolean;
  readonly wrapValue?: boolean;
}) {
  const { role, chevron } = listRowPresentation({
    pressable: onPress !== undefined,
    kind,
  });
  const content = (
    <>
      <View style={styles.text}>
        <Text style={[styles.label, destructive && styles.destructiveLabel]}>
          {label}
        </Text>
        {description !== undefined && (
          <Text style={styles.description}>{description}</Text>
        )}
      </View>
      {value !== undefined && (
        <Text
          numberOfLines={wrapValue ? undefined : 1}
          style={[styles.value, wrapValue && styles.wrappedValue]}
        >
          {value}
        </Text>
      )}
      {chevron && (
        <Text aria-hidden style={styles.chevron}>
          ›
        </Text>
      )}
    </>
  );
  const accessibleLabel = listRowAccessibleLabel({ label, value, description });

  if (onPress === undefined) {
    return (
      <View accessible aria-label={accessibleLabel} style={styles.row}>
        {content}
      </View>
    );
  }
  return (
    <Pressable
      role={role}
      aria-label={accessibleLabel}
      aria-disabled={disabled}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.row,
        pressed && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  sectionHeader: {
    color: theme.colors.textMuted,
    marginTop: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    ...theme.type.captionStrong,
  },
  group: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden",
  },
  separator: {
    backgroundColor: theme.colors.border,
    height: StyleSheet.hairlineWidth,
    marginStart: theme.spacing.md,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: theme.spacing.sm,
    minHeight: theme.touchTarget + theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm + theme.spacing.xs,
  },
  pressed: { backgroundColor: theme.colors.surfacePressed },
  disabled: { opacity: 0.5 },
  text: { flex: 1, gap: 2 },
  label: { color: theme.colors.text, ...theme.type.body },
  destructiveLabel: { color: theme.colors.danger, ...theme.type.bodyStrong },
  description: { color: theme.colors.textMuted, ...theme.type.caption },
  value: {
    color: theme.colors.textMuted,
    flexShrink: 1,
    maxWidth: "45%",
    textAlign: "right",
    ...theme.type.body,
  },
  wrappedValue: { maxWidth: "65%" },
  chevron: {
    color: theme.colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
    marginStart: theme.spacing.xs,
  },
});
