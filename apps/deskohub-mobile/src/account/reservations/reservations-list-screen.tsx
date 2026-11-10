import type { CustomerReservationOrderId } from "@deskohub/workspace-customer-api";
import { useAtomMount, useAtomRefresh, useAtomValue } from "@effect/atom-react";
import { Option } from "effect";
import { AsyncResult } from "effect/unstable/reactivity";
import { Stack, useRouter } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import { AsyncView } from "../../customer-api/async-view";
import { accountAtom } from "../../customer-api/customer-data-runtime";
import type { CustomerRequestFailure } from "../../customer-api/customer-view-error";
import type { AppLocale } from "../../i18n/app-locale";
import { formatInstant } from "../../i18n/date-time-format";
import { useAppLocale } from "../../i18n/locale-context";
import { m } from "../../i18n/messages";
import { theme } from "../../theme";
import { BodyText, Button } from "../../ui/controls";
import { ListGroup, ListRow, SectionHeader } from "../../ui/list";
import { listRowAccessibleLabel } from "../../ui/list-row-presentation";
import { Notice } from "../../ui/notice";
import { ScrollScreen } from "../../ui/scroll-screen";
import { Text } from "../../ui/text";
import {
  type AccountNotice,
  type ReservationsAccess,
  reservationsAccess,
} from "../account-gating";
import { bookingEntryEnabled } from "./booking-entry";
import {
  type ReservationGroups,
  type ReservationListRow,
  reservationRowText,
  reservationStatusTarget,
} from "./reservation-list-model";
import {
  type ReservationsList,
  reservationHistoryAtom,
  reservationsListAtom,
  savedReservationsAtom,
  savedReservationsBeforeAccountAtom,
} from "./reservations-list-state";

const gateNotice: Record<AccountNotice, (locale: AppLocale) => string> = {
  "completion-required": (locale) =>
    m.account_notice_completion_required({}, { locale }),
  "support-required": (locale) =>
    m.account_notice_support_required({}, { locale }),
  unavailable: (locale) => m.account_notice_unavailable({}, { locale }),
  "deletion-pending": (locale) =>
    m.account_notice_deletion_pending({}, { locale }),
};

const gateNoticeOf = (access: ReservationsAccess): AccountNotice | undefined =>
  ({
    available: undefined,
    "completion-required": "completion-required" as const,
    unavailable: access.kind === "unavailable" ? access.notice : undefined,
  })[access.kind];

/** Opens a reservation's status screen. */
const useOpenReservation = () => {
  const router = useRouter();
  return (orderId: CustomerReservationOrderId) =>
    router.push({ pathname: "/reservations/[orderId]", params: { orderId } });
};

function BookHeaderAction() {
  const locale = useAppLocale();
  const router = useRouter();
  return (
    <Pressable
      role="link"
      hitSlop={theme.spacing.sm}
      onPress={() => router.push("/book")}
      style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}
    >
      <Text style={styles.headerActionLabel}>
        {m.reservations_book({}, { locale })}
      </Text>
    </Pressable>
  );
}

/**
 * The Reservations tab: the account's reservations (GET /reservations)
 * grouped as the site groups them, gated by the account's state. Saved
 * reservations show at once while the list loads, and stay when it can't;
 * they also show while the account itself can't be read (offline at launch).
 */
export function ReservationsListScreen() {
  // Read once for the screen, whichever of the views below shows it.
  useAtomMount(savedReservationsAtom);
  const account = useAtomValue(accountAtom);
  return (
    <>
      <Stack.Screen
        options={{
          headerRight: bookingEntryEnabled
            ? () => <BookHeaderAction />
            : undefined,
        }}
      />
      {Option.match(
        Option.map(AsyncResult.value(account), reservationsAccess),
        {
          onNone: () => <ReservationsBeforeAccount />,
          onSome: (access) =>
            access.kind === "available" ? (
              <ReservationsHistory />
            ) : (
              <ReservationsGate access={access} />
            ),
        }
      )}
    </>
  );
}

/** When the account may not see reservations. */
function ReservationsGate({ access }: { readonly access: ReservationsAccess }) {
  const locale = useAppLocale();
  const router = useRouter();
  const account = useAtomValue(accountAtom);
  const refresh = useAtomRefresh(accountAtom);
  const shownNotice = gateNoticeOf(access);
  const notice =
    shownNotice === undefined ? undefined : gateNotice[shownNotice](locale);
  return (
    <ScrollScreen refreshing={account.waiting} onRefresh={refresh}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice tone="info" message={notice} />
      <AsyncView result={account} onRetry={refresh}>
        {() =>
          access.kind === "completion-required" && (
            <ListGroup>
              <ListRow
                label={m.account_section_complete({}, { locale })}
                onPress={() => router.push("/account/complete")}
              />
            </ListGroup>
          )
        }
      </AsyncView>
    </ScrollScreen>
  );
}

/** Before the account is read: the saved reservations, if any. */
function ReservationsBeforeAccount() {
  return (
    <ReservationsListView
      result={useAtomValue(savedReservationsBeforeAccountAtom)}
      onRefresh={useAtomRefresh(accountAtom)}
    />
  );
}

/** The account may see reservations: the list, saved then fresh. */
function ReservationsHistory() {
  return (
    <ReservationsListView
      result={useAtomValue(reservationsListAtom)}
      onRefresh={useAtomRefresh(reservationHistoryAtom)}
    />
  );
}

function ReservationsListView<E extends CustomerRequestFailure>({
  result: list,
  onRefresh: refresh,
}: {
  readonly result: AsyncResult.AsyncResult<ReservationsList, E>;
  readonly onRefresh: () => void;
}) {
  const locale = useAppLocale();
  const savedAt = Option.flatMap(
    AsyncResult.value(list),
    (shown) => shown.savedAt
  );
  return (
    <ScrollScreen refreshing={list.waiting} onRefresh={refresh}>
      {/* Kept mounted so assistive tech announces each change. */}
      <Notice
        tone="info"
        message={Option.getOrUndefined(
          Option.map(savedAt, (time) =>
            m.reservations_last_updated(
              { time: formatInstant(time, locale, "date-time") },
              { locale }
            )
          )
        )}
      />
      <AsyncView result={list} onRetry={refresh}>
        {({ groups }) => <ReservationGroupsView groups={groups} />}
      </AsyncView>
    </ScrollScreen>
  );
}

function ReservationGroupsView({
  groups,
}: {
  readonly groups: ReservationGroups;
}) {
  const locale = useAppLocale();
  const router = useRouter();
  if (groups.empty) {
    return (
      <View style={styles.empty}>
        <BodyText>{m.reservations_empty({}, { locale })}</BodyText>
        {bookingEntryEnabled && (
          <Button
            label={m.reservations_book({}, { locale })}
            onPress={() => router.push("/book")}
          />
        )}
      </View>
    );
  }
  return (
    <>
      {Option.isSome(groups.featured) && (
        <>
          <SectionHeader title={m.reservations_current_title({}, { locale })} />
          <FeaturedReservation row={groups.featured.value} />
        </>
      )}
      {groups.moreCurrent.length > 0 && (
        <>
          <SectionHeader
            title={m.reservations_more_current_title({}, { locale })}
          />
          <ReservationRows rows={groups.moreCurrent} />
        </>
      )}
      <SectionHeader title={m.reservations_past_title({}, { locale })} />
      {groups.past.length > 0 ? (
        <ReservationRows rows={groups.past} />
      ) : (
        <BodyText>{m.reservations_past_empty({}, { locale })}</BodyText>
      )}
      {groups.undated.length > 0 && (
        <>
          <SectionHeader title={m.reservations_undated_title({}, { locale })} />
          <ReservationRows rows={groups.undated} />
        </>
      )}
    </>
  );
}

function ReservationRows({
  rows,
}: {
  readonly rows: ReadonlyArray<ReservationListRow>;
}) {
  const locale = useAppLocale();
  const open = useOpenReservation();
  return (
    <ListGroup>
      {rows.map((row) => {
        const text = reservationRowText(row, locale);
        const target = reservationStatusTarget(row);
        return (
          <ListRow
            key={row.id}
            label={text.title}
            value={text.status}
            description={[
              text.period,
              ...Option.toArray(text.setup),
              text.seats,
            ].join("\n")}
            onPress={Option.getOrUndefined(
              Option.map(target, (orderId) => () => open(orderId))
            )}
          />
        );
      })}
    </ListGroup>
  );
}

/** The first current reservation, shown large. */
function FeaturedReservation({ row }: { readonly row: ReservationListRow }) {
  const locale = useAppLocale();
  const open = useOpenReservation();
  const text = reservationRowText(row, locale);
  const details = [text.period, ...Option.toArray(text.setup), text.seats];
  const content = (
    <>
      <View style={styles.featuredHeading}>
        <Text style={styles.featuredTitle}>{text.title}</Text>
        <Text style={styles.status}>{text.status}</Text>
      </View>
      {details.map((detail) => (
        <Text key={detail} style={styles.featuredDetail}>
          {detail}
        </Text>
      ))}
    </>
  );
  const label = listRowAccessibleLabel({
    label: text.title,
    value: text.status,
    description: details.join(", "),
  });
  return Option.match(reservationStatusTarget(row), {
    onNone: () => (
      <View accessible aria-label={label} style={styles.featured}>
        {content}
      </View>
    ),
    onSome: (orderId) => (
      <Pressable
        role="link"
        aria-label={label}
        onPress={() => open(orderId)}
        style={({ pressed }) => [styles.featured, pressed && styles.pressed]}
      >
        {content}
        <Text aria-hidden style={styles.featuredChevron}>
          ›
        </Text>
      </Pressable>
    ),
  });
}

const styles = StyleSheet.create({
  headerAction: {
    justifyContent: "center",
    minHeight: theme.touchTarget,
    paddingHorizontal: theme.spacing.sm,
  },
  headerActionLabel: {
    color: theme.colors.accent,
    ...theme.type.body,
    fontWeight: "600",
  },
  pressed: { opacity: 0.7 },
  empty: { gap: theme.spacing.md, paddingVertical: theme.spacing.lg },
  featured: {
    backgroundColor: theme.colors.surface,
    borderColor: theme.colors.accent,
    borderRadius: theme.radius.lg,
    borderWidth: StyleSheet.hairlineWidth * 2,
    gap: theme.spacing.xs,
    padding: theme.spacing.md,
  },
  featuredHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: theme.spacing.sm,
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  featuredTitle: { color: theme.colors.text, flex: 1, ...theme.type.heading },
  featuredDetail: { color: theme.colors.textMuted, ...theme.type.body },
  featuredChevron: {
    color: theme.colors.textMuted,
    fontSize: 24,
    lineHeight: 24,
    position: "absolute",
    right: theme.spacing.md,
    bottom: theme.spacing.md,
  },
  status: {
    borderColor: theme.colors.border,
    borderRadius: theme.radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    color: theme.colors.text,
    overflow: "hidden",
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    ...theme.type.caption,
  },
});
