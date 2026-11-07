import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useAppLocale } from "../src/i18n/locale-context";
import { m } from "../src/i18n/messages";
import { theme } from "../src/theme";

export default function HomeScreen() {
  const locale = useAppLocale();

  return (
    <View style={styles.screen}>
      <Text accessibilityRole="header" style={styles.title}>
        {m.home_title({}, { locale })}
      </Text>
      <Text style={styles.tagline}>{m.home_tagline({}, { locale })}</Text>
      {__DEV__ && (
        <Link href="/dev/effect-smoke" style={styles.devLink}>
          {m.home_smoke_link({}, { locale })}
        </Link>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    alignItems: "center",
    backgroundColor: theme.colors.background,
    flex: 1,
    gap: theme.spacing.md,
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  title: { color: theme.colors.text, ...theme.type.title },
  tagline: {
    color: theme.colors.textMuted,
    textAlign: "center",
    ...theme.type.body,
  },
  devLink: {
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.md,
    borderWidth: 1,
    color: theme.colors.accent,
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    ...theme.type.body,
  },
});
