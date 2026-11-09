/**
 * What a list row does when pressed: `navigation` opens another screen,
 * `action` acts in place (such as signing out).
 */
export type ListRowKind = "navigation" | "action";

/**
 * The accessibility role and trailing chevron of a list row. A row without a
 * press handler is plain content; a navigation row is a link with a chevron;
 * an action row is a button.
 */
export const listRowPresentation = ({
  pressable,
  kind,
}: {
  readonly pressable: boolean;
  readonly kind: ListRowKind;
}): {
  readonly role: "link" | "button" | undefined;
  readonly chevron: boolean;
} => {
  if (!pressable) return { role: undefined, chevron: false };
  return kind === "navigation"
    ? { role: "link", chevron: true }
    : { role: "button", chevron: false };
};

/** One label that reads everything the row shows, for assistive tech. */
export const listRowAccessibleLabel = ({
  label,
  value,
  description,
}: {
  readonly label: string;
  readonly value?: string;
  readonly description?: string;
}) => [label, value, description].filter((part) => !!part).join(", ");
