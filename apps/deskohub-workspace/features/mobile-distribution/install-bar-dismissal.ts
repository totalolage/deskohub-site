import { Option, Schema } from "effect";
import {
  readLocalStorageItem,
  writeLocalStorageItem,
} from "@/shared/browser/local-storage";

/*
 * How long the install bar stays away after the visitor closes it, per
 * browser: the first close until the next visit, the second for 7 days, the
 * third for 30 days, the fourth for good. A visit is a run of page views
 * that showed the bar or kept it hidden, each within 30 minutes of the last.
 *
 * The record lives in localStorage. Like the passkey prompt's markers it is a
 * product preference, not analytics, so it doesn't depend on consent.
 */

/** Times are epoch milliseconds. */
export type InstallBarDismissal = {
  /** How often the visitor closed the bar. */
  readonly closes: number;
  /** When the visitor last closed it. */
  readonly closedAt?: number;
  /** When the current visit's first page view happened. */
  readonly visitStartedAt?: number;
  /** When the latest page view happened. */
  readonly lastSeenAt?: number;
};

const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A page view this long after the previous one starts a new visit. */
export const VISIT_GAP_MS = 30 * MINUTE_MS;

/** How long each close hides the bar, by close count. */
const SNOOZE_MS: Readonly<Record<2 | 3, number>> = {
  2: 7 * DAY_MS,
  3: 30 * DAY_MS,
};

const neverDismissed: InstallBarDismissal = { closes: 0 };

/** Notes a page view that shows the bar or keeps it hidden. */
export const notePageView = (
  dismissal: InstallBarDismissal,
  now: number
): InstallBarDismissal => {
  const newVisit =
    dismissal.lastSeenAt === undefined ||
    now - dismissal.lastSeenAt >= VISIT_GAP_MS;
  return {
    ...dismissal,
    visitStartedAt: newVisit ? now : dismissal.visitStartedAt,
    lastSeenAt: now,
  };
};

/** Notes that the visitor closed the bar; a close isn't a page view. */
export const noteClose = (
  dismissal: InstallBarDismissal,
  now: number
): InstallBarDismissal => ({
  ...dismissal,
  closes: dismissal.closes + 1,
  closedAt: now,
});

/** Whether the visitor's closes still keep the bar hidden at `now`. */
export const isDismissed = (
  { closes, closedAt, visitStartedAt }: InstallBarDismissal,
  now: number
): boolean => {
  if (closes <= 0) return false;
  if (closes >= 4 || closedAt === undefined) return true;
  if (closes === 1) {
    return visitStartedAt === undefined || closedAt >= visitStartedAt;
  }
  return now < closedAt + SNOOZE_MS[closes === 2 ? 2 : 3];
};

/** The localStorage key holding this browser's record. */
export const installBarDismissalStorageKey = "deskohub:install-bar-dismissal";

const dismissalJson = Schema.fromJsonString(
  Schema.Struct({
    closes: Schema.Finite,
    closedAt: Schema.optionalKey(Schema.Finite),
    visitStartedAt: Schema.optionalKey(Schema.Finite),
    lastSeenAt: Schema.optionalKey(Schema.Finite),
  })
);
const decodeDismissal = Schema.decodeUnknownOption(dismissalJson);

/** This browser's record; a missing or unreadable one counts as no closes. */
export const readInstallBarDismissal = (): InstallBarDismissal => {
  const raw = readLocalStorageItem(installBarDismissalStorageKey);
  if (raw === null) return neverDismissed;
  return Option.getOrElse(decodeDismissal(raw), () => neverDismissed);
};

const writeInstallBarDismissal = (dismissal: InstallBarDismissal): void => {
  writeLocalStorageItem(
    installBarDismissalStorageKey,
    JSON.stringify(dismissal)
  );
};

/**
 * Notes a page view in this browser's record and says whether the bar
 * stays hidden on it.
 */
export const recordInstallBarPageView = (now = Date.now()): boolean => {
  const dismissal = notePageView(readInstallBarDismissal(), now);
  writeInstallBarDismissal(dismissal);
  return isDismissed(dismissal, now);
};

/** Notes in this browser's record that the visitor closed the bar. */
export const recordInstallBarClose = (now = Date.now()): void => {
  writeInstallBarDismissal(noteClose(readInstallBarDismissal(), now));
};
