import type {
  CustomerReservationAccess,
  CustomerReservationOrderId,
} from "@deskohub/workspace-customer-api";
import { useAtom, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { type Duration, Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { useIsFocused } from "expo-router";
import { StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { Button, LiveMessage } from "../../ui/controls";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import { useAccessPinView } from "./access-pin-view";
import {
  accessCountdownAtom,
  accessErrorMessage,
  accessWindowKey,
  copyAccessCodeAtom,
  reservationAccessAtom,
  shownAccess,
} from "./access-screen-state";
import {
  type AccessWindowState,
  accessWindowOf,
  Countdown,
  countdownOf,
} from "./access-window";

/**
 * An order's door PIN (GET access): the code in large digits, a copy
 * action, when the lock accepts it, and a live countdown to the window's
 * start or end. Pull to read it again.
 */
export function ReservationAccessScreen({
  orderId,
}: {
  readonly orderId: CustomerReservationOrderId;
}) {
  const locale = useAppLocale();
  const access = shownAccess(useAtomValue(reservationAccessAtom(orderId)));
  const refresh = useAtomRefresh(reservationAccessAtom(orderId));
  return (
    <ScrollScreen
      refreshing={!AsyncResult.isInitial(access) && access.waiting}
      onRefresh={refresh}
    >
      <AsyncView
        result={access}
        onRetry={refresh}
        errorMessage={(error) => accessErrorMessage(error, locale)}
      >
        {(value) => <AccessDetails orderId={orderId} access={value} />}
      </AsyncView>
    </ScrollScreen>
  );
}

function AccessDetails({
  orderId,
  access,
}: {
  readonly orderId: CustomerReservationOrderId;
  readonly access: CustomerReservationAccess;
}) {
  const locale = useAppLocale();
  const focused = useIsFocused();
  useAccessPinView(focused);
  const windowState = Option.flatten(
    AsyncResult.value(
      useAtomValue(accessCountdownAtom(accessWindowKey(access)))
    )
  );
  const [copied, copy] = useAtom(copyAccessCodeAtom(orderId));
  const ended = Option.exists(windowState, (state) => state._tag === "Ended");
  return (
    <>
      <View style={styles.card}>
        <AccessCode code={access.code} ended={ended} />
        {Option.isSome(windowState) && (
          <CountdownLine state={windowState.value} locale={locale} />
        )}
        <Text style={styles.window}>
          {Option.match(accessWindowOf(access), {
            onNone: () =>
              m.reservations_access_window_unavailable({}, { locale }),
            onSome: ({ startsAt, endsAt }) =>
              m.reservations_access_window(
                {
                  start: formatInstant(startsAt, locale, "date-time"),
                  end: formatInstant(endsAt, locale, "date-time"),
                },
                { locale }
              ),
          })}
        </Text>
      </View>
      {/* Kept mounted so the window's end is announced when it comes, or
          on return when it ended while another screen was in front. */}
      <Notice
        tone="warning"
        message={
          ended && focused
            ? m.reservations_access_expired({}, { locale })
            : undefined
        }
      />
      <Button
        label={m.reservations_access_copy({}, { locale })}
        variant="secondary"
        onPress={() => copy(access.code)}
        disabled={copied.waiting}
      />
      <LiveMessage
        role="status"
        message={
          AsyncResult.isSuccess(copied) && !copied.waiting
            ? m.reservations_access_copied({}, { locale })
            : undefined
        }
      />
      <Notice
        tone="error"
        message={
          AsyncResult.isFailure(copied)
            ? m.reservations_access_copy_failed({}, { locale })
            : undefined
        }
      />
    </>
  );
}

/** The PIN in large digits, read out by assistive tech one digit at a time. */
function AccessCode({
  code,
  ended,
}: {
  readonly code: string;
  readonly ended: boolean;
}) {
  const locale = useAppLocale();
  const characters = Array.from(code);
  return (
    <View
      accessible
      accessibilityRole="text"
      aria-label={m.reservations_access_code_label(
        { digits: characters.join(" ") },
        { locale }
      )}
      style={styles.code}
    >
      {characters.map((character, index) => (
        <View
          aria-hidden
          importantForAccessibility="no-hide-descendants"
          // biome-ignore lint/suspicious/noArrayIndexKey: PIN digits are positional and may repeat.
          key={`${index}-${character}`}
          style={styles.digit}
        >
          <Text
            maxFontSizeMultiplier={2}
            style={[styles.digitText, ended && styles.digitTextEnded]}
          >
            {character}
          </Text>
        </View>
      ))}
    </View>
  );
}

/** How long until the window opens or closes; an ended window shows none. */
function CountdownLine({
  state,
  locale,
}: {
  readonly state: AccessWindowState;
  readonly locale: AppLocale;
}) {
  return (
    <>
      {state._tag === "Upcoming" && (
        <Text style={styles.countdown}>
          {m.reservations_access_starts_in(
            { duration: countdownText(state.startsIn, locale) },
            { locale }
          )}
        </Text>
      )}
      {state._tag === "Open" && (
        <Text style={[styles.countdown, styles.countdownOpen]}>
          {m.reservations_access_valid_for(
            { duration: countdownText(state.remaining, locale) },
            { locale }
          )}
        </Text>
      )}
    </>
  );
}

const countdownText = (duration: Duration.Duration, locale: AppLocale) =>
  Countdown.$match(countdownOf(duration), {
    Days: ({ days, hours }) =>
      m.reservations_access_duration_days({ days, hours }, { locale }),
    Hours: ({ hours, minutes }) =>
      m.reservations_access_duration_hours({ hours, minutes }, { locale }),
    Minutes: ({ minutes, seconds }) =>
      m.reservations_access_duration_minutes({ minutes, seconds }, { locale }),
    Seconds: ({ seconds }) =>
      m.reservations_access_duration_seconds({ seconds }, { locale }),
  });

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.border,
    borderRadius: theme.radius.lg,
    borderWidth: 1,
    gap: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  // Boxes size to their digit, so large accessibility text grows them and
  // wraps the row instead of overlapping digits.
  code: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
    justifyContent: "center",
  },
  digit: {
    alignItems: "center",
    backgroundColor: theme.colors.surfacePressed,
    borderRadius: theme.radius.md,
    justifyContent: "center",
    minWidth: 40,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.sm + theme.spacing.xs,
  },
  digitText: {
    color: theme.colors.accent,
    fontSize: 34,
    fontVariant: ["tabular-nums"],
    fontWeight: "600",
  },
  digitTextEnded: { color: theme.colors.textMuted },
  countdown: {
    color: theme.colors.text,
    fontVariant: ["tabular-nums"],
    textAlign: "center",
    ...theme.type.body,
    fontWeight: "600",
  },
  countdownOpen: { color: theme.colors.accent },
  window: {
    color: theme.colors.textMuted,
    textAlign: "center",
    ...theme.type.caption,
  },
});
