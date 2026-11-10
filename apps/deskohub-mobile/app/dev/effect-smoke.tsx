import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { AppLocale } from "../../src/i18n/app-locale";
import { useAppLocale } from "../../src/i18n/locale-context";
import { m } from "../../src/i18n/messages";
import type { SmokeReport } from "../../src/smoke/smoke-case";
import { runSmokeCases } from "../../src/smoke/smoke-case";
import { smokeCases } from "../../src/smoke/smoke-cases";
import { theme } from "../../src/theme";
import { Text } from "../../src/ui/text";

const formatTotals = (
  { passed, failed, total }: SmokeReport,
  locale: AppLocale
): string => m.smoke_totals({ passed, failed, total }, { locale });

/** Development-only screen that runs the runtime smoke cases on the device. */
export default function EffectSmokeRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <EffectSmokeScreen />;
}

function EffectSmokeScreen() {
  const locale = useAppLocale();
  const [report, setReport] = useState<SmokeReport>();
  // StrictMode replays the effect on the same instance; the ref keeps that
  // replay on the first run instead of starting the cases twice.
  const run = useRef<Promise<SmokeReport>>(undefined);

  useEffect(() => {
    let mounted = true;
    run.current ??= runSmokeCases(smokeCases);
    void run.current.then((finished) => {
      if (!mounted) return;
      setReport(finished);
      AccessibilityInfo.announceForAccessibility(
        formatTotals(finished, locale)
      );
    });
    return () => {
      mounted = false;
    };
  }, [locale]);

  const state = report
    ? m.smoke_finished({}, { locale })
    : m.smoke_running({}, { locale });

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          {m.smoke_title({}, { locale })}
        </Text>
        <Text
          accessibilityLabel={state}
          style={styles.text}
          testID={report ? "smoke-finished" : "smoke-running"}
        >
          {state}
        </Text>
        {report && (
          <SmokeTotals locale={locale} position="top" report={report} />
        )}
        {report?.results.map((result) => (
          <View
            accessible
            key={`${result.group}/${result.name}`}
            style={styles.result}
            testID={`smoke-case-${result.group}-${result.name}`}
          >
            <Text style={styles.status}>
              {result.status} {result.group} {result.name}
            </Text>
            <Text style={styles.text}>{result.actual}</Text>
          </View>
        ))}
        {report && (
          <SmokeTotals locale={locale} position="bottom" report={report} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function SmokeTotals({
  locale,
  position,
  report,
}: {
  readonly locale: AppLocale;
  readonly position: "top" | "bottom";
  readonly report: SmokeReport;
}) {
  const totals = formatTotals(report, locale);
  return (
    <Text
      accessibilityLabel={totals}
      style={styles.totals}
      testID={`smoke-totals-${position}`}
    >
      {totals}
    </Text>
  );
}

const styles = StyleSheet.create({
  screen: { backgroundColor: theme.colors.background, flex: 1 },
  content: { gap: theme.spacing.sm, padding: theme.spacing.md },
  heading: { color: theme.colors.text, fontSize: 24, fontWeight: "600" },
  totals: { color: theme.colors.text, fontSize: 18, fontWeight: "600" },
  result: { gap: 2 },
  status: { color: theme.colors.text, fontSize: 14, fontWeight: "600" },
  text: { color: theme.colors.text, fontSize: 14 },
});
