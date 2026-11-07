import { Redirect } from "expo-router";
import { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import type { SmokeReport } from "../../src/smoke/smoke-case";
import { runSmokeCases } from "../../src/smoke/smoke-case";
import { smokeCases } from "../../src/smoke/smoke-cases";

const labels = {
  heading: "Runtime smoke cases",
  running: "Running",
  finished: "Finished",
  totals: ({ passed, failed, total }: SmokeReport) =>
    `${passed} passed, ${failed} failed, ${total} total`,
};

/** Development-only screen that runs the runtime smoke cases on the device. */
export default function EffectSmokeRoute() {
  if (!__DEV__) return <Redirect href="/" />;
  return <EffectSmokeScreen />;
}

function EffectSmokeScreen() {
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
      AccessibilityInfo.announceForAccessibility(labels.totals(finished));
    });
    return () => {
      mounted = false;
    };
  }, []);

  const state = report ? labels.finished : labels.running;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text accessibilityRole="header" style={styles.heading}>
          {labels.heading}
        </Text>
        <Text
          accessibilityLabel={state}
          style={styles.text}
          testID={report ? "smoke-finished" : "smoke-running"}
        >
          {state}
        </Text>
        {report && <SmokeTotals position="top" report={report} />}
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
        {report && <SmokeTotals position="bottom" report={report} />}
      </ScrollView>
    </SafeAreaView>
  );
}

function SmokeTotals({
  position,
  report,
}: {
  readonly position: "top" | "bottom";
  readonly report: SmokeReport;
}) {
  const totals = labels.totals(report);
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
  screen: { backgroundColor: "#00024f", flex: 1 },
  content: { gap: 12, padding: 16 },
  heading: { color: "#ffffff", fontSize: 24, fontWeight: "600" },
  totals: { color: "#ffffff", fontSize: 18, fontWeight: "600" },
  result: { gap: 2 },
  status: { color: "#ffffff", fontSize: 14, fontWeight: "600" },
  text: { color: "#ffffff", fontSize: 14 },
});
