import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import { Effect, Exit, Layer, Option } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import {
  encodeAuthCallbackReturn,
  getAccountSectionPath,
  getAccountSignInPath,
  readAuthCallbackReturnTo,
  signInCallbackReturnParam,
} from "@/features/account/routes";
import type { AccountSection } from "@/features/account/sections";
import { m } from "@/features/i18n";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../case-runner";
import type { DatasourceConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import { E2EDatabase } from "../integrations/database.service";
import { makeE2ETelemetryMock } from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import { accountSectionLandmarks } from "./account-sections";
import {
  type WorkspaceE2EAccountCaseId,
  workspaceE2EAccountCaseIds,
  workspaceE2EAccountCaseSkipReason,
  workspaceE2EAccountMagicLinkLedger,
} from "./catalog";
import {
  makeWorkspaceE2EAccountRecipient,
  type WorkspaceE2EAccountConfig,
  workspaceE2EAccountMainRecipientLabel,
  workspaceE2EReferralOwnerRecipientLabel,
} from "./config";
import type { WorkspaceE2EAccountJournal } from "./journal";
import {
  type AccountProfileField,
  accountProfileFieldSelectors,
  type WorkspaceE2EAccountBrowser,
  type WorkspaceE2EAccountLaneBrowser,
} from "./lane-browser";
import type { WorkspaceE2EAccountPasskeys } from "./passkeys";
import {
  type MagicLinkOperation,
  type MagicLinkRateBudget,
  makeMagicLinkRateBudget,
} from "./rate-budget";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountJournalRef,
  WorkspaceE2EAccountLifecycleHandoff,
} from "./types";
import type { WorkspaceE2EPreviewLogs } from "./vercel-log-retrieval";

const fixedNow = new Date("2026-09-11T12:00:00.000Z");
const fixedNowMs = fixedNow.getTime();
const baseUrl = "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app";
const expectedHost = new URL(baseUrl).host;
const syntheticRunId = "cases-test-run";
const session = "workspace-account-cases-test";

const completionTitle = "Complete your profile";
const completionReferralApplied =
  "Your referral code was applied. You’ll get 15% off your first paid booking.";
const deletionPendingTitle = "Account deletion is pending";
const czechDeletionPendingTitle = "Smazání účtu čeká na dokončení";
const deletionReauthLinkSent =
  "If the address can receive mail, a new link is on its way.";
const deletedTitle = "Your account was deleted";
const signInCodeInvalid =
  "That code does not match. Check the latest email and try again.";
const useDifferentEmailLabel = "Use a different email";
const deletionReauthCodeTitle = "Confirm it is you";
const signInCodeSelector = "#account-sign-in-code";
const supportTitle = "We need to verify your profile";
const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const signOutSelector = "#account-sign-out";
const languageTriggerSelector = '[data-slot="select-trigger"]';
const languageOptionCsSelector = '[role="option"]:has-text("Čeština")';
const languageOptionEnSelector = '[role="option"]:has-text("English (US)")';
const englishLanguageLabel = "Preferred language";
const czechLanguageLabel = "Preferovaný jazyk";
const englishFaqTitle = "Frequently Asked Questions";
const czechFaqTitle = "Často kladené otázky";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";
const syntheticReferralCode = "RFLSYNTHETIC1";
const referralOwnerCustomerId = "customer-referral-owner";
const profileFirstNameSelector = "#account-profile-first-name";
const profileLastNameSelector = "#account-profile-last-name";
const profilePhoneSelector = "#account-profile-phone";
const profileSubmitSelector = "#account-profile-form button[type=submit]";
const billingKindSelector = "#account-profile-billing-kind";
const billingCompanyNameSelector = "#account-profile-billing-company-name";
const profileDraftSelectors = [
  profileFirstNameSelector,
  profileLastNameSelector,
  profilePhoneSelector,
] as const;

type FakeMessageKind =
  | "initial-main"
  | "accepted-b"
  | "reauthentication"
  | "reactivation";

type FakeMessage = {
  readonly createdAt: number;
  readonly id: string;
  readonly kind: FakeMessageKind;
  readonly link: string;
  /** The sign-in code every email carries while sign-in codes are on. */
  readonly code: string;
  readonly recipient: string;
  consumed: boolean;
};

type FakeProfile = {
  companyName: string | null;
  deleted: boolean;
  expireDate: string | null;
  readonly firstName: string;
  readonly id: string;
  readonly email: string;
  lastName: string;
  phone: string;
};

type FakeUser = {
  readonly email: string;
  createdAt: Date;
  deletionRequestedAt: Date | null;
  readonly id: string;
  session: boolean;
};

type FakeEvent = {
  readonly type:
    | "send"
    | "receive"
    | "logout"
    | "consume"
    | "deletion"
    | "replay"
    | "unlink"
    | "relink"
    | "ambiguity"
    | "code-rejected"
    | "consume-code"
    | "provider-expire"
    | "provider-reactivate"
    | "provider-create"
    | "referral-owner-seed";
  readonly customerId?: string;
  readonly id?: string;
  readonly kind?: FakeMessageKind;
  readonly mode?: "active" | "expired";
  readonly recipient?: string;
  readonly userId?: string;
};

type FakeBrowserAction = {
  readonly kind: "open" | "fill" | "press" | "focus" | "click";
  readonly selectorOrDestination: string;
};

type JournalSnapshot = {
  readonly eventIndex: number;
  readonly journal: WorkspaceE2EAccountJournal;
};

type ReauthenticationObservation = {
  readonly linkedCustomerId: string | undefined;
  readonly marker: boolean;
  readonly userId: string | undefined;
};

type DeletionObservation = {
  readonly authRowPresent: boolean;
  readonly customerId: string;
  readonly linkPresent: boolean;
  readonly profileExpired: boolean;
  readonly profileDeleted: boolean;
  readonly sessionPresent: boolean;
  readonly userId: string;
};

type ReactivationObservation = {
  readonly customerId: string | undefined;
  readonly historyPresent: boolean;
  readonly userId: string | undefined;
};

type UnlinkObservation = {
  readonly accountId: string;
  readonly customerId: string;
  readonly precedingDestination: string;
};

type OpenAccountResult = {
  readonly destination: string;
  readonly text: string;
};

type ConsumeResult = {
  readonly destination: string;
  /** Whether the link landed on the rejected-link card. */
  readonly failed?: boolean;
  readonly text: string;
};

/** The page a sign-in email was requested from, which its link returns to. */
type FakeSignInOrigin = {
  readonly locale: FakeLocale;
  readonly returnTo?: string;
};

/** The callback a synthetic link carries: its locale and return target. */
const readFakeCallback = (link: string) => {
  const callback = new URL(
    new URL(link).searchParams.get("callbackURL") ?? "",
    "https://callback.invalid"
  );
  const locale = fakeLocalePath.exec(callback.pathname)?.[1] as
    | FakeLocale
    | undefined;
  if (locale === undefined) throw new Error("the synthetic link has no locale");
  return {
    locale,
    path: callback.pathname,
    returnTo: readAuthCallbackReturnTo(
      callback.searchParams.get(signInCallbackReturnParam)
    ),
  };
};

/** The accepted inbox notice as the sign-in card renders it. */
const fakeAcceptedInboxText = (locale: FakeLocale) =>
  [
    m.accountSignInAcceptedTitle({}, { locale }),
    m.accountSignInAcceptedBody({}, { locale }),
    m.accountSignInAcceptedSameBrowser({}, { locale }),
    m.accountSignInAssistantBrowserHint({}, { locale }),
  ].join(" ");

/** The rejected-link card, with its request-a-new-link action. */
const fakeCallbackFailedText = (locale: FakeLocale) =>
  [
    m.accountCallbackFailedTitle({}, { locale }),
    m.accountCallbackFailedBody({}, { locale }),
    m.accountCallbackFailedAction({}, { locale }),
  ].join(" ");

/**
 * A stateful, provider-shaped boundary for the account case factory. The
 * profile and reservation history seed is intentionally explicit: those two
 * catalog cases remain covered by their own browser tests, while this test
 * starts the lifecycle lane immediately after their successful postcondition.
 */
class FakeAccountExternalState {
  readonly browserActions: FakeBrowserAction[] = [];
  readonly createdAuthIds: string[] = [];
  readonly deletionObservations: DeletionObservation[] = [];
  readonly events: FakeEvent[] = [];
  readonly journalSnapshots: JournalSnapshot[] = [];
  readonly listCalls: Array<{
    readonly recipient: string;
  }> = [];
  readonly reauthenticationObservations: ReauthenticationObservation[] = [];
  readonly reactivationObservations: ReactivationObservation[] = [];
  readonly retrieveCalls: Array<{
    readonly excludeLogEntryIds: readonly string[];
    readonly recipient: string;
  }> = [];
  readonly unlinkObservations: UnlinkObservation[] = [];
  readonly authReads: string[] = [];
  readonly providerCalls: string[] = [];
  readonly messagesByRecipient = new Map<string, FakeMessage[]>();
  readonly profiles = new Map<string, FakeProfile>();
  /** Recorded referral attributions: invited customer to referrer. */
  readonly referralAttributions = new Map<string, string>();
  readonly referralOwnerSeeds: Array<{
    readonly accountId: string;
    readonly dotyposCustomerId: string;
    readonly email: string;
  }> = [];
  readonly usersByEmail = new Map<string, FakeUser>();
  readonly usersById = new Map<string, FakeUser>();
  readonly linksByUserId = new Map<string, string>();
  readonly consumedLinks = new Set<string>();
  /** When the cross-browser sign-in opened and closed its second browser. */
  readonly assistantBrowserEvents: Array<"close" | "open"> = [];
  /** Where each consumed link landed: path and query, in order. */
  readonly linkLandings: string[] = [];
  /** The cross-browser sign-in's review moments, in capture order. */
  readonly signInHandoffReviews: Array<{
    readonly stage: string;
    readonly url: string;
  }> = [];
  readonly languageSaves: Array<"cs-CZ" | "en-US"> = [];
  readonly switcherSaves: Array<"cs-CZ" | "en-US"> = [];
  readonly languageReviews: Array<{
    readonly stage: string;
    readonly url: string;
  }> = [];

  /**
   * The proxy's saved-preference authority: a signed-in page request whose
   * URL locale differs from the preference is redirected to it. Turning it
   * off models the old path-first precedence.
   */
  preferenceRedirects = true;
  /** Whether a signed-in header switch saves the preference first. */
  switcherSavesPreference = true;
  /**
   * Whether each opened language listbox misses its first Escape, as when
   * the key lands before the listbox listens for it.
   */
  listboxMissesFirstEscape = false;
  /**
   * The preview's `login_email_code` flag: every sign-in email also carries
   * a code, and the sign-in card and deletion dialog open a code step.
   */
  signInCodes = false;

  /**
   * The site default preference: the migration backfills existing accounts
   * and the user.create hook seeds new accounts from the initiating site
   * locale, so the synthetic account restores English (US) on every sign-in
   * until a save changes it.
   */
  localePreference: "cs-CZ" | "en-US" = "en-US";

  currentAuthUserId: string | undefined;
  historyReady = false;
  readonly profileDrafts = new Map<string, string>();
  billingKind: "business" | "individual" = "individual";
  readonly reservations: Array<{
    readonly id: string;
    status: "CANCELLED" | "CONFIRMED";
  }> = [];
  readonly fixtureLocaleWrites: Array<"cs-CZ" | "en-US"> = [];
  lastDestination = "";
  staleSession = false;
  deletionDialog = false;
  deletionConfirmationChecked = false;
  reauthenticationDialog = false;
  /**
   * The preview's `login_passkeys` flag: the sign-in form offers passkeys,
   * and a passkey-capable browser gets the post-sign-in prompt.
   */
  passkeys = false;
  readonly passkeyActions: string[] = [];
  readonly passkeysByUserId = new Map<string, number>();
  passkeyName: string | undefined;
  /** How many links were consumed when the authenticator was added. */
  private authenticatorAddedAfterLinks: number | undefined;
  /**
   * The tab's email sign-in note: the next account page takes it and offers
   * the passkey prompt once, like `shouldOfferPasskeyPrompt`.
   */
  private emailSignInNoted = false;
  private passkeyPromptOffered = false;
  private authenticatorCredentials = 0;
  private messageSequence = 0;
  private duplicateProfileSequence = 0;
  private deletedIdentity = false;

  constructor(
    readonly config: WorkspaceE2EAccountConfig,
    readonly mainRecipient: string,
    readonly acceptedBRecipient: string,
    readonly referralOwnerRecipient: string
  ) {}

  recordBrowserAction(action: FakeBrowserAction) {
    this.browserActions.push(action);
  }

  private requirePasskeyUser(): FakeUser {
    if (this.authenticatorAddedAfterLinks === undefined) {
      throw new Error("the passkey journey ran without an authenticator");
    }
    const userId = this.currentAuthUserId;
    if (!userId) throw new Error("the passkey journey has no signed-in user");
    return this.requireUser(userId);
  }

  passkeyCount(userId: string): number {
    return this.passkeysByUserId.get(userId) ?? 0;
  }

  addAuthenticator() {
    if (!this.passkeys) throw new Error("passkeys are off on this preview");
    this.passkeyActions.push("add-authenticator");
    this.authenticatorAddedAfterLinks ??= this.consumedLinks.size;
  }

  removeAuthenticator() {
    this.passkeyActions.push("remove-authenticator");
    this.authenticatorAddedAfterLinks = undefined;
  }

  readAuthenticatorCredentials() {
    if (this.authenticatorAddedAfterLinks === undefined) {
      throw new Error("no virtual authenticator is installed");
    }
    return Array.from({ length: this.authenticatorCredentials }, () => ({
      isResidentCredential: true,
      rpId: new URL(this.config.baseUrl).hostname,
    }));
  }

  /** The prompt opens only for an email sign-in that found the authenticator. */
  createPasskeyFromPrompt() {
    const user = this.requirePasskeyUser();
    if (
      this.authenticatorAddedAfterLinks === undefined ||
      this.consumedLinks.size <= this.authenticatorAddedAfterLinks ||
      !this.linksByUserId.has(user.id) ||
      !this.passkeyPromptOffered
    ) {
      throw new Error("no post-sign-in passkey prompt is shown");
    }
    this.passkeyActions.push("create-from-prompt");
    this.passkeysByUserId.set(user.id, this.passkeyCount(user.id) + 1);
    this.authenticatorCredentials = 1;
  }

  signInWithPasskey(): FakeUser {
    if (this.authenticatorCredentials === 0 || this.currentAuthUserId) {
      throw new Error(
        "passkey sign-in needs a credential and a signed-out tab"
      );
    }
    const user = this.usersByEmail.get(this.mainRecipient);
    if (!user || this.passkeyCount(user.id) === 0) {
      throw new Error("the account holds no passkey to sign in with");
    }
    this.passkeyActions.push("sign-in");
    this.currentAuthUserId = user.id;
    user.session = true;
    user.createdAt = new Date(user.createdAt.getTime() + 1_000);
    return user;
  }

  renamePasskey(name: string) {
    const user = this.requirePasskeyUser();
    if (this.passkeyCount(user.id) !== 1) {
      throw new Error("rename expected the account's only passkey");
    }
    this.passkeyActions.push("rename");
    this.passkeyName = name;
  }

  deletePasskey(name: string) {
    const user = this.requirePasskeyUser();
    if (this.passkeyCount(user.id) !== 1 || this.passkeyName !== name) {
      throw new Error("delete expected the renamed last passkey");
    }
    this.passkeyActions.push("delete");
    this.passkeysByUserId.set(user.id, 0);
    this.passkeyName = undefined;
  }

  createPasskeyFromSettings() {
    const user = this.requirePasskeyUser();
    if (this.staleSession) {
      throw new Error(
        "settings creation asked a stale session to reauthenticate"
      );
    }
    this.passkeyActions.push("create-from-settings");
    this.passkeysByUserId.set(user.id, this.passkeyCount(user.id) + 1);
    this.authenticatorCredentials = 1;
  }

  confirmDeletionWithPasskey() {
    const user = this.requirePasskeyUser();
    if (!this.staleSession || this.passkeyCount(user.id) === 0) {
      throw new Error("passkey reauthentication needs a stale passkey account");
    }
    this.passkeyActions.push("confirm-deletion");
    this.staleSession = false;
    user.createdAt = new Date(fixedNowMs);
  }

  recordJournal(update: {
    readonly authUserIds: readonly string[];
    readonly dotyposCustomerIds: readonly string[];
    readonly dotyposReservationIds: readonly string[];
  }) {
    const previous =
      this.journalSnapshots.at(-1)?.journal ??
      ({
        authUserIds: [],
        completed: false,
        dotyposCustomerIds: [],
        dotyposReservationIds: [],
        laneId: "account-lane",
        startedAt: fixedNow.toISOString(),
        version: 1,
      } satisfies WorkspaceE2EAccountJournal);
    const merge = (existing: readonly string[], added: readonly string[]) => [
      ...existing,
      ...added.filter((value) => !existing.includes(value)),
    ];
    const journal = {
      ...previous,
      authUserIds: merge(previous.authUserIds, update.authUserIds),
      dotyposCustomerIds: merge(
        previous.dotyposCustomerIds,
        update.dotyposCustomerIds
      ),
      dotyposReservationIds: merge(
        previous.dotyposReservationIds,
        update.dotyposReservationIds
      ),
    } satisfies WorkspaceE2EAccountJournal;
    this.journalSnapshots.push({
      eventIndex: this.events.length,
      journal,
    });
  }

  get journal(): WorkspaceE2EAccountJournal {
    return (
      this.journalSnapshots.at(-1)?.journal ??
      ({
        authUserIds: [],
        completed: false,
        dotyposCustomerIds: [],
        dotyposReservationIds: [],
        laneId: "account-lane",
        startedAt: fixedNow.toISOString(),
        version: 1,
      } satisfies WorkspaceE2EAccountJournal)
    );
  }

  /**
   * The profile form submit: the first submit completes the profile by
   * creating and linking the retained provider profile; later submits save
   * the optional profile and billing drafts to it. A completion that submits
   * a seeded owner's code records the referral.
   */
  submitProfile(referralCode: string | undefined): "completed" | "saved" {
    const userId = this.currentAuthUserId;
    if (!userId) throw new Error("the profile form was submitted signed out");
    const linkedCustomerId = this.linksByUserId.get(userId);
    if (!linkedCustomerId) {
      const retained = this.makeProfile({
        email: this.mainRecipient,
        firstName: this.profileDrafts.get(profileFirstNameSelector) ?? "",
        id: "customer-retained",
      });
      retained.lastName = "";
      this.profiles.set(retained.id, retained);
      this.linksByUserId.set(userId, retained.id);
      if (referralCode !== undefined) {
        const owner = this.referralOwnerSeeds[0];
        if (!owner || referralCode !== syntheticReferralCode) {
          throw new Error("the completion submitted an unknown referral code");
        }
        this.referralAttributions.set(retained.id, owner.dotyposCustomerId);
      }
      return "completed";
    }
    const profile = this.requireProfile(linkedCustomerId);
    profile.lastName = this.profileDrafts.get(profileLastNameSelector) ?? "";
    profile.phone = this.profileDrafts.get(profilePhoneSelector) ?? "";
    profile.companyName =
      this.billingKind === "business"
        ? (this.profileDrafts.get(billingCompanyNameSelector) ?? null)
        : null;
    return "saved";
  }

  createReservation(customerId: string) {
    this.requireProfile(customerId);
    const id = `reservation-${this.reservations.length + 1}`;
    this.reservations.push({ id, status: "CONFIRMED" });
    return id;
  }

  cancelReservation(reservationId: string) {
    const reservation = this.reservations.find(
      ({ id }) => id === reservationId
    );
    if (!reservation) throw new Error("unknown synthetic reservation");
    reservation.status = "CANCELLED";
    this.historyReady = true;
  }

  setLocalePreference(userId: string, locale: "cs-CZ" | "en-US") {
    this.requireUser(userId);
    this.fixtureLocaleWrites.push(locale);
    this.localePreference = locale;
  }

  seedPendingReauthenticationForTest() {
    this.createAuthUser("auth-original", this.mainRecipient);
    const retained = this.makeProfile({
      email: this.mainRecipient,
      firstName: "E2E",
      id: "customer-retained",
    });
    this.profiles.set(retained.id, retained);
    this.linksByUserId.set("auth-original", retained.id);
    const user = this.requireUser("auth-original");
    user.deletionRequestedAt = fixedNow;
    this.currentAuthUserId = user.id;
    this.historyReady = true;
    const message = this.makeMessage(this.mainRecipient, "reauthentication");
    return message.link;
  }

  createProfile(input: { readonly email: string; readonly firstName: string }) {
    let customerId = referralOwnerCustomerId;
    if (input.email !== this.referralOwnerRecipient) {
      this.duplicateProfileSequence += 1;
      customerId = `customer-duplicate-${this.duplicateProfileSequence}`;
    }
    const profile = this.makeProfile({
      email: input.email,
      firstName: input.firstName,
      id: customerId,
    });
    this.profiles.set(customerId, profile);
    this.providerCalls.push("create-profile");
    this.events.push({
      customerId,
      id: customerId,
      type: "provider-create",
    });
    return customerId;
  }

  expireProfile(customerId: string) {
    const profile = this.requireProfile(customerId);
    profile.expireDate = new Date(fixedNowMs - 60_000).toISOString();
    this.providerCalls.push("expire-profile");
    this.events.push({ customerId, type: "provider-expire" });
  }

  readProfile(customerId: string): Customer {
    const profile = this.requireProfile(customerId);
    return {
      _cloudId: "synthetic-cloud",
      companyId: null,
      companyName: profile.companyName,
      deleted: profile.deleted,
      display: true,
      email: profile.email,
      expireDate: profile.expireDate,
      firstName: profile.firstName,
      flags: "",
      id: profile.id,
      lastName: profile.lastName,
      phone: profile.phone,
      points: null,
    } as Customer;
  }

  assertNoProfile(email: string) {
    const found = [...this.profiles.values()].some(
      (profile) => profile.email === email
    );
    if (found)
      throw new Error("the synthetic profile exists before verification");
  }

  seedReferralOwner(input: {
    readonly accountId: string;
    readonly dotyposCustomerId: string;
    readonly email: string;
  }) {
    if (!this.profiles.has(input.dotyposCustomerId)) {
      throw new Error("the referral owner was seeded without its profile");
    }
    this.referralOwnerSeeds.push({
      accountId: input.accountId,
      dotyposCustomerId: input.dotyposCustomerId,
      email: input.email,
    });
    this.events.push({
      customerId: input.dotyposCustomerId,
      type: "referral-owner-seed",
    });
    return { code: syntheticReferralCode, promotionCodeId: "promotion-owner" };
  }

  findAuthUserId(email: string) {
    this.authReads.push(email);
    return this.usersByEmail.get(email)?.id;
  }

  findLinkedCustomerId(userId: string) {
    this.authReads.push(`link:${userId}`);
    return this.linksByUserId.get(userId);
  }

  setDeletionMarker(userId: string, value: Date | null) {
    const user = this.requireUser(userId);
    user.deletionRequestedAt = value;
  }

  setSessionCreatedAt(userId: string, value: Date) {
    const user = this.requireUser(userId);
    user.createdAt = value;
    this.staleSession = fixedNowMs - value.getTime() > 10 * 60_000;
  }

  assertNoAuthRows(userId: string) {
    const user = this.usersById.get(userId);
    if (user || user?.session) {
      throw new Error("the synthetic auth rows still exist");
    }
  }

  removeAccountLink(accountId: string, customerId: string) {
    if (this.lastDestination !== "/contact") {
      throw new Error(
        "account link removal did not follow public contact navigation"
      );
    }
    const current = this.linksByUserId.get(accountId);
    if (current !== customerId) {
      throw new Error("account link removal targeted a different customer");
    }
    this.linksByUserId.delete(accountId);
    this.unlinkObservations.push({
      accountId,
      customerId,
      precedingDestination: this.lastDestination,
    });
    this.events.push({ customerId, type: "unlink", userId: accountId });
  }

  saveLocalePreference(locale: "cs-CZ" | "en-US") {
    this.languageSaves.push(locale);
    this.localePreference = locale;
  }

  sendMessage(
    email: string,
    kind: "sign-in" | "reauthentication",
    origin?: FakeSignInOrigin
  ) {
    let messageKind: FakeMessageKind;
    if (kind === "reauthentication") {
      messageKind = "reauthentication";
    } else if (email === this.acceptedBRecipient) {
      messageKind = "accepted-b";
    } else if (this.deletedIdentity) {
      messageKind = "reactivation";
    } else {
      messageKind = "initial-main";
    }
    const message = this.makeMessage(email, messageKind, origin);
    this.events.push({
      id: message.id,
      kind: message.kind,
      recipient: email,
      type: "send",
    });
    return message;
  }

  listMessageIds(email: string) {
    this.listCalls.push({ recipient: email });
    return (this.messagesByRecipient.get(email) ?? []).map(({ id }) => id);
  }

  retrieveMessage(
    email: string,
    excludeLogEntryIds: readonly string[],
    startedAt: Date
  ) {
    this.retrieveCalls.push({
      excludeLogEntryIds: [...excludeLogEntryIds],
      recipient: email,
    });
    const excluded = new Set(excludeLogEntryIds);
    const candidates = (this.messagesByRecipient.get(email) ?? []).filter(
      (message) =>
        !excluded.has(message.id) && message.createdAt >= startedAt.getTime()
    );
    if (candidates.length !== 1 || !candidates[0]) {
      throw new Error("synthetic link retrieval did not find one new message");
    }
    const [message] = candidates;
    this.events.push({
      id: message.id,
      kind: message.kind,
      recipient: email,
      type: "receive",
    });
    return message;
  }

  /**
   * Better Auth's code sign-in: a wrong code leaves the email usable, and
   * the right one consumes it like its link, creating a new account.
   */
  consumeCode(email: string, code: string): "invalid" | "verified" {
    const message = (this.messagesByRecipient.get(email) ?? []).at(-1);
    if (!this.signInCodes || !message || message.consumed) {
      throw new Error("the synthetic code sign-in has no usable email");
    }
    if (message.code !== code) {
      this.events.push({ id: message.id, type: "code-rejected" });
      return "invalid";
    }
    if (message.kind !== "accepted-b") {
      throw new Error("only the accepted-b email is signed in with its code");
    }
    message.consumed = true;
    this.createAuthUser("auth-accepted-b", email);
    this.currentAuthUserId = "auth-accepted-b";
    this.events.push({
      id: message.id,
      kind: message.kind,
      type: "consume-code",
      userId: "auth-accepted-b",
    });
    return "verified";
  }

  isConsumedLink(link: string) {
    return this.consumedLinks.has(link);
  }

  consumeLink(link: string): ConsumeResult {
    const message = [...this.messagesByRecipient.values()]
      .flat()
      .find((candidate) => candidate.link === link);
    if (!message) throw new Error("unknown synthetic magic link");

    const callback = readFakeCallback(link);
    if (message.consumed) {
      this.events.push({ id: message.id, type: "replay" });
      const failure = new URLSearchParams({ error: "INVALID_TOKEN" });
      if (callback.returnTo !== undefined) {
        failure.set(
          signInCallbackReturnParam,
          encodeAuthCallbackReturn(callback.returnTo)
        );
      }
      return {
        destination: `${callback.path}?${failure}`,
        failed: true,
        text: fakeCallbackFailedText(callback.locale),
      };
    }

    message.consumed = true;
    this.consumedLinks.add(link);
    this.emailSignInNoted = true;
    switch (message.kind) {
      case "initial-main": {
        // A magic-link sign-in for an existing verified account signs into
        // the same user instead of creating a duplicate identity; the lane's
        // later account cases rely on that persisted link and preference.
        if (this.usersById.has("auth-original")) {
          this.currentAuthUserId = "auth-original";
        } else {
          this.createAuthUser("auth-original", message.recipient);
          this.currentAuthUserId = "auth-original";
        }
        this.events.push({
          id: message.id,
          kind: message.kind,
          type: "consume",
          userId: "auth-original",
        });
        return callback.returnTo === undefined
          ? { destination: "/en-US/account", text: completionTitle }
          : { destination: callback.returnTo, text: "" };
      }
      case "reauthentication": {
        const user = this.requireUser("auth-original");
        this.currentAuthUserId = user.id;
        user.session = true;
        this.staleSession = false;
        const linkedCustomerId = this.linksByUserId.get(user.id);
        this.reauthenticationObservations.push({
          linkedCustomerId,
          marker: user.deletionRequestedAt !== null,
          userId: user.id,
        });
        this.events.push({
          id: message.id,
          kind: message.kind,
          type: "consume",
          userId: user.id,
        });
        return { destination: "/en-US/account", text: deletionPendingTitle };
      }
      case "reactivation": {
        const retainedCustomerId = [...this.profiles.values()].find(
          (profile) =>
            profile.email === message.recipient &&
            profile.deleted === false &&
            profile.expireDate !== null
        )?.id;
        if (!retainedCustomerId) {
          throw new Error("reactivation link has no retained profile");
        }
        const newUserId = "auth-reactivated";
        this.createAuthUser(newUserId, message.recipient);
        this.currentAuthUserId = newUserId;
        // The account page claims and reactivates the retained profile.
        this.events.push({
          id: message.id,
          kind: message.kind,
          type: "consume",
          userId: newUserId,
        });
        this.reactivationObservations.push({
          customerId: retainedCustomerId,
          historyPresent: this.historyReady,
          userId: newUserId,
        });
        // The new account has no preference, so the sign-in saves the
        // callback's locale as it.
        this.localePreference = callback.locale;
        return callback.returnTo === undefined
          ? { destination: "/en-US/account", text: "Current and upcoming" }
          : { destination: callback.returnTo, text: "" };
      }
      case "accepted-b":
        throw new Error("the generic accepted-b message must not be consumed");
    }
  }

  openAccount(): OpenAccountResult {
    this.passkeyPromptOffered = this.emailSignInNoted;
    this.emailSignInNoted = false;
    if (
      !this.currentAuthUserId ||
      !this.usersById.has(this.currentAuthUserId)
    ) {
      this.lastDestination = "/en-US/auth/sign-in";
      return {
        destination: "/en-US/auth/sign-in",
        text: "Sign in",
      };
    }

    const user = this.requireUser(this.currentAuthUserId);
    user.session = true;
    const linkedCustomerId = this.linksByUserId.get(user.id);
    if (user.deletionRequestedAt !== null) {
      this.lastDestination = "/en-US/account";
      return { destination: "/en-US/account", text: deletionPendingTitle };
    }

    if (linkedCustomerId) {
      this.lastDestination = "/en-US/account";
      return { destination: "/en-US/account", text: "Current and upcoming" };
    }

    const candidates = [...this.profiles.values()].filter(
      (profile) => profile.email === user.email && !profile.deleted
    );
    if (candidates.length !== 1 || !candidates[0]) {
      if (candidates.length > 1) {
        this.events.push({ type: "ambiguity", userId: user.id });
        this.lastDestination = "/en-US/account";
        return { destination: "/en-US/account", text: supportTitle };
      }
      this.lastDestination = "/en-US/account";
      return { destination: "/en-US/account", text: completionTitle };
    }

    const profile = candidates[0];
    const mode = profile.expireDate === null ? "active" : "expired";
    if (mode === "expired") {
      profile.expireDate = null;
      this.events.push({
        customerId: profile.id,
        mode,
        type: "provider-reactivate",
        userId: user.id,
      });
    }
    this.linksByUserId.set(user.id, profile.id);
    this.events.push({
      customerId: profile.id,
      mode,
      type: "relink",
      userId: user.id,
    });
    this.lastDestination = "/en-US/account";
    return { destination: "/en-US/account", text: "Current and upcoming" };
  }

  logout() {
    const userId = this.currentAuthUserId;
    if (!userId) throw new Error("the browser logged out without an account");
    const user = this.requireUser(userId);
    user.session = false;
    this.currentAuthUserId = undefined;
    this.events.push({ type: "logout", userId });
  }

  deleteAccount() {
    const userId = this.currentAuthUserId;
    if (!userId) throw new Error("deletion has no authenticated user");
    const user = this.requireUser(userId);
    const customerId = this.linksByUserId.get(userId);
    if (!customerId) throw new Error("deletion has no linked customer");
    const profile = this.requireProfile(customerId);
    profile.expireDate = new Date(fixedNowMs - 60_000).toISOString();
    profile.deleted = false;
    this.linksByUserId.delete(userId);
    user.session = false;
    this.usersById.delete(userId);
    this.usersByEmail.delete(user.email);
    this.currentAuthUserId = undefined;
    this.deletedIdentity = true;
    this.events.push({
      customerId,
      type: "deletion",
      userId,
    });
    this.deletionObservations.push({
      authRowPresent: this.usersById.has(userId),
      customerId,
      linkPresent: this.linksByUserId.has(userId),
      profileDeleted: profile.deleted,
      profileExpired: profile.expireDate !== null,
      sessionPresent: user.session,
      userId,
    });
  }

  private makeProfile(input: {
    readonly email: string;
    readonly firstName: string;
    readonly id: string;
  }): FakeProfile {
    return {
      companyName: null,
      deleted: false,
      email: input.email,
      expireDate: null,
      firstName: input.firstName,
      id: input.id,
      lastName: "E2E",
      phone: "",
    };
  }

  private makeMessage(
    email: string,
    kind: FakeMessageKind,
    origin: FakeSignInOrigin = { locale: this.config.locale }
  ): FakeMessage {
    this.messageSequence += 1;
    const id = `message-${this.messageSequence}`;
    const token = `synthetic-token-${this.messageSequence}`;
    const callbackURL =
      origin.returnTo === undefined
        ? `/${origin.locale}/auth/callback`
        : `/${origin.locale}/auth/callback?${signInCallbackReturnParam}=${encodeAuthCallbackReturn(origin.returnTo)}`;
    const link = `${this.config.baseUrl}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callbackURL)}`;
    const message = {
      code: String(100_000 + this.messageSequence),
      createdAt: fixedNowMs,
      id,
      kind,
      link,
      recipient: email,
      consumed: false,
    } satisfies FakeMessage;
    const messages = this.messagesByRecipient.get(email) ?? [];
    messages.push(message);
    this.messagesByRecipient.set(email, messages);
    return message;
  }

  private createAuthUser(id: string, email: string) {
    if (this.usersById.has(id)) {
      throw new Error("the synthetic auth id was created twice");
    }
    const user = {
      createdAt: fixedNow,
      deletionRequestedAt: null,
      email,
      id,
      session: true,
    } satisfies FakeUser;
    this.usersById.set(id, user);
    this.usersByEmail.set(email, user);
    this.createdAuthIds.push(id);
  }

  private requireProfile(customerId: string) {
    const profile = this.profiles.get(customerId);
    if (!profile) throw new Error("unknown synthetic provider profile");
    return profile;
  }

  private requireUser(userId: string) {
    const user = this.usersById.get(userId);
    if (!user) throw new Error("unknown synthetic auth user");
    return user;
  }
}

type FakeLocale = "cs-CZ" | "en-US";

const fakeLocalePath = /^\/(cs-CZ|en-US)(?=\/|$)/;

class FakeBrowser {
  private currentUrl = "";
  private localeCookie: FakeLocale | undefined;
  private pageText = "";
  /** The `textContent` of the profile language control's label. */
  private languageControlLabel: string | null = null;
  /** The `textContent` of the page's `h1`. */
  private heading: string | null = null;
  private emailValue = "";
  private nativeValidationBlocked = false;
  private formReady = false;
  private referralFieldValue: string | undefined;
  /** The proxy's first-party referral cookie: the first shared link wins. */
  referralCookie: string | undefined;
  private selectedSection = "";
  private languageListboxOpen = false;
  private languageListboxMissesEscape = false;
  private focusedSelector = "";
  /** The code step on screen: the sign-in card's, or the deletion dialog's. */
  private codeStep:
    | { readonly dialog: boolean; readonly recipient: string }
    | undefined;
  private codeInputEmpty = false;
  private codeStepsShown = 0;
  /**
   * The sign-in card's sessionStorage request, which a later sign-in page in
   * the same tab restores, when it has no return target or the request's,
   * until a link or code signs this tab in or the customer switches email.
   */
  private storedRequest:
    | { readonly recipient: string; readonly returnTo: string | undefined }
    | undefined;

  /**
   * `anonymous` is the assistant's browser of the cross-browser sign-in: a
   * second browser context, which no link the lane consumes signs in.
   */
  constructor(
    readonly external: FakeAccountExternalState,
    private readonly anonymous = false
  ) {}

  /**
   * The select value is the page locale. Re-picking it fires no
   * onValueChange, exactly as the real Radix Select behaves.
   */
  private get languageValue(): "cs-CZ" | "en-US" {
    return this.pageLocale();
  }

  private signedIn(): boolean {
    if (this.anonymous) return false;
    const userId = this.external.currentAuthUserId;
    return userId !== undefined && this.external.usersById.has(userId);
  }

  private pageLocale(): FakeLocale {
    const locale = fakeLocalePath.exec(new URL(this.currentUrl).pathname)?.[1];
    if (locale !== "cs-CZ" && locale !== "en-US") {
      throw new Error("the synthetic page has no locale");
    }
    return locale;
  }

  /**
   * The proxy for one localized page request: a signed-in browser lands on
   * its saved preference, a guest keeps the URL locale, and the locale cookie
   * follows the resolved locale either way.
   */
  private resolveLocale(pathLocale: FakeLocale): FakeLocale {
    const resolved =
      this.signedIn() && this.external.preferenceRedirects
        ? this.external.localePreference
        : pathLocale;
    this.localeCookie = resolved;
    return resolved;
  }

  private withLocale(url: string, locale: FakeLocale): string {
    const parsed = new URL(url);
    parsed.pathname = parsed.pathname.replace(fakeLocalePath, `/${locale}`);
    return parsed.toString();
  }

  private profileLabel(locale: FakeLocale) {
    return locale === "cs-CZ" ? czechLanguageLabel : englishLanguageLabel;
  }

  private selectAccountSection(section: "billing" | "danger" | "profile") {
    this.selectedSection = section;
    const url = new URL(this.currentUrl);
    const locale = fakeLocalePath.exec(url.pathname)?.[1];
    if (locale === "cs-CZ" || locale === "en-US") {
      url.pathname = getAccountSectionPath(locale, section);
      this.currentUrl = url.toString();
    }
  }

  /** Selects a section through the account navigation, as the lane does. */
  selectSection(section: AccountSection) {
    if (section === "danger" || section === "billing") {
      this.selectAccountSection(section);
      return;
    }
    if (section !== "profile") {
      throw new Error(`the account case selected the ${section} section`);
    }
    if (this.pageLocale() !== "en-US") {
      throw new Error("the English account navigation was clicked in Czech");
    }
    this.selectAccountSection("profile");
    this.pageText = `${this.pageText} ${englishLanguageLabel.toLocaleUpperCase()}`;
    this.languageControlLabel = englishLanguageLabel;
  }

  open(url: string) {
    const parsed = new URL(url);
    this.external.recordBrowserAction({
      kind: "open",
      selectorOrDestination: parsed.pathname,
    });
    this.referralFieldValue = undefined;
    const sharedCode = parsed.searchParams.get("ref");
    if (sharedCode !== null && this.referralCookie === undefined) {
      this.referralCookie = sharedCode;
    }
    // The proxy keeps the query while it adds the browser's locale.
    if (parsed.pathname === "/account") parsed.pathname = "/en-US/account";
    this.external.lastDestination =
      parsed.pathname.replace(/^\/en-US/, "") || "/";
    this.navigate(parsed.toString());
  }

  /** Places a lane browser that an earlier case left on a page. */
  startAt(url: string) {
    this.navigate(url);
  }

  /**
   * A code step as the page renders it. Its resend countdown ticks, so two
   * otherwise identical steps rarely read the same second.
   */
  private showCodeStep(recipient: string, dialog: boolean) {
    this.codeStep = { dialog, recipient };
    this.codeInputEmpty = true;
    this.formReady = false;
    this.codeStepsShown += 1;
    const masked = `${recipient.slice(0, 1)}•••${recipient.slice(recipient.lastIndexOf("@"))}`;
    if (dialog) {
      this.pageText = [
        deletionReauthCodeTitle,
        `We emailed a 6-digit code to ${masked}. It expires in 10 minutes.`,
        "6-digit code",
        `Send a new email in ${61 - this.codeStepsShown} s`,
      ].join("\n");
      return;
    }
    const locale = this.pageLocale();
    this.pageText = [
      m.accountSignInCodeTitle({}, { locale }),
      m.accountSignInCodeBody({ email: masked }, { locale }),
      m.accountSignInCodeLabel({}, { locale }),
      `Send a new email in ${61 - this.codeStepsShown} s`,
      m.accountSignInCodeChangeEmail({}, { locale }),
      m.accountSignInCodeAssistantHint({}, { locale }),
      m.accountSignInAssistantBrowserHint({}, { locale }),
    ].join("\n");
  }

  /** The sent step a sign-in page restores from this tab's request. */
  private restoreStoredRequest(requestedReturnTo: string | undefined) {
    const request = this.storedRequest;
    if (
      request === undefined ||
      (requestedReturnTo !== undefined &&
        request.returnTo !== requestedReturnTo)
    ) {
      return;
    }
    if (this.external.signInCodes) {
      this.showCodeStep(request.recipient, false);
      return;
    }
    this.pageText = fakeAcceptedInboxText(this.pageLocale());
    this.formReady = false;
  }

  /** A document navigation through the proxy. */
  private navigate(requested: string) {
    this.codeStep = undefined;
    this.languageListboxOpen = false;
    this.selectedSection = "";
    this.languageControlLabel = null;
    this.heading = null;
    const pathLocale = fakeLocalePath.exec(new URL(requested).pathname)?.[1] as
      | FakeLocale
      | undefined;
    const url =
      pathLocale === undefined
        ? requested
        : this.withLocale(requested, this.resolveLocale(pathLocale));
    const parsed = new URL(url);
    const locale =
      pathLocale === undefined ? undefined : this.pageLocaleOf(url);
    const suffix = parsed.pathname.replace(fakeLocalePath, "");
    if (locale !== undefined && suffix === "/auth/sign-in") {
      this.currentUrl = url;
      this.pageText = "Sign in";
      this.formReady = true;
      this.emailValue = "";
      this.nativeValidationBlocked = false;
      this.restoreStoredRequest(
        parsed.searchParams.get("returnTo") ?? undefined
      );
      return;
    }
    if (
      this.anonymous &&
      locale !== undefined &&
      (suffix === "/account" || suffix === "/account/profile")
    ) {
      this.navigate(
        `${this.external.config.baseUrl}${getAccountSignInPath(locale)}`
      );
      return;
    }
    if (locale !== undefined && suffix === "/reservation/cowork") {
      this.currentUrl = url;
      const userId = this.external.currentAuthUserId;
      const email =
        this.signedIn() &&
        userId !== undefined &&
        // Reservation pages only read an existing link, never claim one.
        this.external.linksByUserId.has(userId)
          ? this.external.usersById.get(userId)?.email
          : undefined;
      this.pageText = email === undefined ? "Cowork" : `Booking as ${email}`;
      this.formReady = false;
      return;
    }
    if (
      locale !== undefined &&
      (suffix === "/account" || suffix === "/account/profile")
    ) {
      const result = this.external.openAccount();
      const destination = this.withLocale(
        `${this.external.config.baseUrl}${result.destination}`,
        locale
      );
      // A profile route stays deep-linked when the account page opens;
      // completion and sign-in destinations still use their own paths.
      const profile =
        suffix === "/account/profile" &&
        !result.destination.endsWith("/auth/sign-in");
      const accountDestination = new URL(destination);
      if (profile) {
        accountDestination.pathname = getAccountSectionPath(locale, "profile");
      }
      accountDestination.search = profile ? parsed.search : "";
      this.currentUrl = accountDestination.toString();
      // Rendered page text applies the label's CSS uppercase, as
      // `innerText` does; only its `textContent` keeps the message casing.
      const text = this.localizedText(result.text, locale);
      this.pageText = profile
        ? `${text} ${this.profileLabel(locale).toLocaleUpperCase()}`
        : text;
      this.languageControlLabel = profile ? this.profileLabel(locale) : null;
      if (profile) this.selectedSection = "profile";
      this.formReady = result.destination.endsWith("/auth/sign-in");
      this.emailValue = "";
      this.nativeValidationBlocked = false;
      if (result.text === completionTitle) {
        this.referralFieldValue = this.referralCookie;
      }
      if (result.destination.endsWith("/auth/sign-in")) {
        this.restoreStoredRequest(undefined);
      }
      return;
    }
    if (locale !== undefined && suffix === "/faq") {
      this.currentUrl = url;
      this.pageText = locale === "cs-CZ" ? czechFaqTitle : englishFaqTitle;
      this.heading = this.pageText;
      this.formReady = false;
      return;
    }
    if (parsed.pathname === "/en-US/contact") {
      this.currentUrl = url;
      this.pageText = "Contact";
      this.formReady = false;
      return;
    }
    if (parsed.pathname === "/en-US/account/deleted") {
      this.currentUrl = url;
      this.pageText = deletedTitle;
      this.formReady = false;
      return;
    }
    if (parsed.pathname === "/api/auth/magic-link/verify") {
      if (this.anonymous && !this.external.isConsumedLink(url)) {
        throw new Error("the assistant's browser consumed an unused link");
      }
      const result = this.external.consumeLink(url);
      // A completed link sign-in forgets the tab's stored code request.
      if (!result.failed) {
        this.storedRequest = undefined;
      }
      // The callback lands through the proxy like any page request, and a
      // rejected link stays on the callback in the link's locale.
      const landing = `${this.external.config.baseUrl}${result.destination}`;
      if (!result.failed) this.external.linkLandings.push(result.destination);
      if (!result.failed && result.destination.includes("/reservation/")) {
        this.navigate(landing);
        return;
      }
      const destinationLocale = (fakeLocalePath.exec(
        new URL(landing).pathname
      )?.[1] ?? "en-US") as FakeLocale;
      const landingLocale = result.failed
        ? destinationLocale
        : this.resolveLocale(destinationLocale);
      this.currentUrl = this.withLocale(landing, landingLocale);
      this.pageText = result.failed
        ? result.text
        : this.localizedText(result.text, landingLocale);
      this.formReady = false;
      this.referralFieldValue =
        result.text === completionTitle ? this.referralCookie : undefined;
      return;
    }
    throw new Error("unknown synthetic browser destination");
  }

  /** The only fake page copy the lane reads in both locales. */
  private localizedText(text: string, locale: FakeLocale) {
    return locale === "cs-CZ" && text === deletionPendingTitle
      ? czechDeletionPendingTitle
      : text;
  }

  private pageLocaleOf(url: string): FakeLocale {
    return fakeLocalePath.exec(new URL(url).pathname)?.[1] as FakeLocale;
  }

  /** Native activation of a header language switcher link. */
  /** Activates the header's link to the locale. */
  switchLocale(locale: FakeLocale) {
    this.external.recordBrowserAction({
      kind: "press",
      selectorOrDestination: `[data-locale-switcher] a[href^="/${locale}"]`,
    });
    // An open listbox takes the activation as an outside interaction.
    if (this.languageListboxOpen) return;
    if (this.signedIn() && this.external.switcherSavesPreference) {
      this.external.switcherSaves.push(locale);
      this.external.saveLocalePreference(locale);
    }
    this.navigate(this.withLocale(this.currentUrl, locale));
  }

  waitForHandler(selector: string, handler: string) {
    if (selector === signInCodeSelector) {
      if (handler !== "onChange" || this.codeStep === undefined) {
        throw new Error("the sign-in code input is not shown");
      }
      return;
    }
    if (selector.endsWith(languageTriggerSelector)) {
      if (handler !== "onPointerDown" || this.selectedSection !== "profile") {
        throw new Error("the language trigger is not on the profile section");
      }
      return;
    }
    if (
      selector !== signOutSelector ||
      handler !== "onClick" ||
      !this.signedIn() ||
      !new URL(this.currentUrl).pathname.startsWith(
        `/${this.pageLocale()}/account`
      )
    ) {
      throw new Error("the sign-out handler is not on a signed-in account");
    }
  }

  waitForUrl(matches: (url: string) => boolean) {
    if (!matches(this.currentUrl)) {
      throw new Error("the synthetic browser URL assertion did not match");
    }
    return this.currentUrl;
  }

  captureLanguageReview(stage: string) {
    this.external.languageReviews.push({ stage, url: this.currentUrl });
  }

  fill(selector: string, value: string) {
    this.external.recordBrowserAction({
      kind: "fill",
      selectorOrDestination: selector,
    });
    if (
      (profileDraftSelectors as readonly string[]).includes(selector) ||
      selector === billingCompanyNameSelector
    ) {
      this.external.profileDrafts.set(selector, value);
      return;
    }
    if (selector === signInCodeSelector) {
      if (this.codeStep === undefined || this.codeStep.dialog) {
        throw new Error("the synthetic browser typed a code outside sign-in");
      }
      // Six digits submit on their own.
      const outcome = this.external.consumeCode(this.codeStep.recipient, value);
      if (outcome === "invalid") {
        this.pageText = `${this.pageText}\n${signInCodeInvalid}`;
        this.codeInputEmpty = true;
        return;
      }
      // A typed code leaves for the request's return target, else the
      // account.
      const returnTo = this.storedRequest?.returnTo;
      this.storedRequest = undefined;
      this.navigate(
        `${this.external.config.baseUrl}${returnTo ?? `/${this.pageLocale()}/account`}`
      );
      return;
    }
    if (selector !== signInEmailSelector) {
      throw new Error("the synthetic browser filled an unexpected control");
    }
    this.emailValue = value;
    this.nativeValidationBlocked = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }

  /** Follows the failed-callback card's request-a-new-link action. */
  requestNewLinkAfterFailedCallback(locale: FakeLocale) {
    const action = m.accountCallbackFailedAction({}, { locale });
    this.external.recordBrowserAction({
      kind: "click",
      selectorOrDestination: `a:has-text("${action}")`,
    });
    const callback = new URL(this.currentUrl);
    if (
      locale !== this.pageLocale() ||
      callback.searchParams.get("error") === null
    ) {
      throw new Error("the request-a-new-link action is off the failure card");
    }
    this.navigate(
      `${this.external.config.baseUrl}${getAccountSignInPath(
        this.pageLocale(),
        readAuthCallbackReturnTo(
          callback.searchParams.get(signInCallbackReturnParam)
        )
      )}`
    );
  }

  /** The accepted step's button that starts another sign-in request. */
  /**
   * The accepted step's restart control: the code step's "use a different
   * email", or the link card's "send another link". The label must name the
   * control the page shows.
   */
  restartSignIn(buttonLabel: string) {
    this.external.recordBrowserAction({
      kind: "click",
      selectorOrDestination: `button:has-text("${buttonLabel}")`,
    });
    if (this.codeStep?.dialog) {
      throw new Error("the deletion dialog's code step has no restart control");
    }
    const shown =
      this.codeStep === undefined
        ? "Send another link"
        : useDifferentEmailLabel;
    if (buttonLabel !== shown) {
      throw new Error("the restart control has another label");
    }
    this.storedRequest = undefined;
    this.pageText = "Sign in";
    this.formReady = true;
    this.nativeValidationBlocked = false;
    // A different email returns the form with the address prefilled for
    // editing; another link resets the form in place, and the URL keeps its
    // query.
    this.emailValue = this.codeStep?.recipient ?? "";
    this.codeStep = undefined;
  }

  click(selector: string) {
    this.external.recordBrowserAction({
      kind: "click",
      selectorOrDestination: selector,
    });
    if (selector === signInSubmitSelector) {
      if (this.nativeValidationBlocked) {
        this.pageText = "Sign in";
        return;
      }
      const page = new URL(this.currentUrl);
      const message = this.external.sendMessage(this.emailValue, "sign-in", {
        locale: this.pageLocale(),
        returnTo: page.searchParams.get("returnTo") ?? undefined,
      });
      if (message.kind !== "reauthentication") {
        this.storedRequest = {
          recipient: this.emailValue,
          returnTo: page.searchParams.get("returnTo") ?? undefined,
        };
      }
      if (this.external.signInCodes) {
        this.showCodeStep(this.emailValue, false);
        return;
      }
      const response = fakeAcceptedInboxText(this.pageLocale());
      this.pageText =
        message.kind === "reauthentication" ? deletionReauthLinkSent : response;
      this.formReady = false;
      return;
    }
    if (selector === signOutSelector) {
      const locale = this.pageLocale();
      this.external.logout();
      this.currentUrl = `${this.external.config.baseUrl}/${locale}`;
      this.pageText = "Sign in";
      this.formReady = false;
      return;
    }
    if (selector === deleteTriggerSelector) {
      if (this.pageText !== deletionPendingTitle) {
        throw new Error("the deletion trigger was shown outside pending state");
      }
      this.external.deletionDialog = true;
      this.external.deletionConfirmationChecked = false;
      return;
    }
    if (selector === deleteConfirmCheckboxSelector) {
      if (!this.external.deletionDialog) {
        throw new Error("deletion confirmation was opened without its dialog");
      }
      this.external.deletionConfirmationChecked = true;
      return;
    }
    if (selector === deleteConfirmSelector) {
      if (
        !this.external.deletionDialog ||
        !this.external.deletionConfirmationChecked
      ) {
        throw new Error("deletion confirmation bypassed its checkbox");
      }
      this.external.deletionDialog = false;
      if (this.external.staleSession) {
        this.external.reauthenticationDialog = true;
        return;
      }
      this.external.deleteAccount();
      this.pageText = deletedTitle;
      this.currentUrl = `${this.external.config.baseUrl}/en-US/account/deleted`;
      return;
    }
    if (selector === deleteReauthSendSelector) {
      if (!this.external.reauthenticationDialog) {
        throw new Error("reauthentication was sent without its dialog");
      }
      this.external.sendMessage(
        this.external.mainRecipient,
        "reauthentication"
      );
      if (this.external.signInCodes) {
        this.showCodeStep(this.external.mainRecipient, true);
        return;
      }
      this.pageText = deletionReauthLinkSent;
      return;
    }
    if (selector === profileSubmitSelector) {
      if (this.external.submitProfile(this.referralFieldValue) === "saved") {
        this.pageText = "Profile updated.";
        return;
      }
      // The linked account shows the applied referral notice, and the
      // recorded referral uses up the remembered code.
      const referralApplied = this.referralFieldValue !== undefined;
      this.referralFieldValue = undefined;
      if (referralApplied) this.referralCookie = undefined;
      this.pageText = referralApplied
        ? `Save profile\n${completionReferralApplied}`
        : "Save profile";
      return;
    }
    if (selector === languageTriggerSelector) {
      this.languageListboxOpen = true;
      this.languageListboxMissesEscape = this.external.listboxMissesFirstEscape;
      return;
    }
    if (
      selector === languageOptionCsSelector ||
      selector === languageOptionEnSelector
    ) {
      if (!this.languageListboxOpen) {
        throw new Error("the language option was clicked without a listbox");
      }
      this.languageListboxOpen = false;
      const chosen = selector === languageOptionCsSelector ? "cs-CZ" : "en-US";
      if (chosen === this.languageValue) return;
      // The shared locale switch saves the preference, then moves the
      // document to the same URL under the chosen locale either way.
      this.external.saveLocalePreference(chosen);
      this.navigate(this.withLocale(this.currentUrl, chosen));
      return;
    }
    throw new Error("the synthetic browser clicked an unexpected control");
  }

  focus(selector: string) {
    this.focusedSelector = selector;
    this.external.recordBrowserAction({
      kind: "focus",
      selectorOrDestination: selector,
    });
  }

  press(key: string) {
    this.external.recordBrowserAction({
      kind: "press",
      selectorOrDestination: key,
    });
    if (key === "Escape" && this.languageListboxMissesEscape) {
      this.languageListboxMissesEscape = false;
    } else if (key === "Escape") {
      this.languageListboxOpen = false;
    }
    if (key === "End" && this.focusedSelector === billingKindSelector) {
      this.external.billingKind = "business";
    }
  }

  /** Whether the page's Better Auth session is the email's. */
  sessionMatches(email: string) {
    const userId = this.external.currentAuthUserId;
    return (
      this.signedIn() &&
      userId !== undefined &&
      this.external.usersById.get(userId)?.email === email
    );
  }

  signInEmailBlocked() {
    return this.nativeValidationBlocked;
  }

  setLocaleCookie(locale: FakeLocale) {
    this.localeCookie = locale;
  }

  hasLocaleCookie(locale: FakeLocale) {
    return this.localeCookie === locale;
  }

  /** The completion form's login email input is read-only. */
  completionLoginEmail(email: string) {
    return { matches: email === this.external.mainRecipient, readOnly: true };
  }

  /** The linked profile shows the login email as text only. */
  linkedLoginEmail(email: string) {
    return { editable: false, matches: email === this.external.mainRecipient };
  }

  profileDrafts(drafts: Readonly<Record<AccountProfileField, string>>) {
    const preserved = (field: AccountProfileField) =>
      this.external.profileDrafts.get(accountProfileFieldSelectors[field]) ===
      drafts[field];
    return {
      billingPreserved: preserved("billingCompanyName"),
      profilePreserved: (["firstName", "lastName", "phone"] as const).every(
        preserved
      ),
    };
  }

  isLanguageListOpen() {
    return this.languageListboxOpen;
  }

  waitForFormSubmitHandler(
    selector: string,
    fieldSelectors: readonly string[]
  ) {
    if (selector !== signInFormSelector || !this.formReady) {
      throw new Error("the sign-in form submit handler is not ready");
    }
    if (
      fieldSelectors.length !== 1 ||
      fieldSelectors[0] !== signInEmailSelector
    ) {
      throw new Error("the sign-in readiness wait omitted its email field");
    }
  }

  waitForText(matches: (text: string) => boolean) {
    if (!matches(this.pageText)) {
      throw new Error("the synthetic browser text assertion did not match");
    }
    return this.pageText;
  }

  /** The cowork page renders the entry tier its URL carries as selected. */
  waitForCoworkSelection(entryTier: string) {
    const page = new URL(this.currentUrl);
    if (
      !page.pathname.endsWith("/reservation/cowork") ||
      page.searchParams.get("entryTier") !== entryTier
    ) {
      throw new Error("the cowork page does not show the selection");
    }
  }

  waitForLanguageControlLabel(label: string) {
    if (this.languageControlLabel !== label) {
      throw new Error("the language control does not carry that label");
    }
  }

  waitForHeading(heading: string) {
    if (this.heading !== heading) {
      throw new Error("the page heading does not match");
    }
  }

  waitForBusinessBilling() {
    if (this.external.billingKind !== "business") {
      throw new Error("the billing kind is not business");
    }
  }

  waitForLinkedProfileForm(submitLabel: string) {
    if (submitLabel !== "Save profile") {
      throw new Error(
        "the linked edit form's submit control has another label"
      );
    }
    const userId = this.external.currentAuthUserId;
    if (!userId || !this.external.linksByUserId.has(userId)) {
      throw new Error("the linked edit form is not shown");
    }
  }

  waitForEmptiedSignInCode() {
    if (this.codeStep === undefined || !this.codeInputEmpty) {
      throw new Error("the code input was not emptied for another try");
    }
  }

  waitForDeletionDialog() {
    if (!this.external.deletionDialog) {
      throw new Error("the deletion confirmation dialog is missing");
    }
  }

  waitForReauthenticationDialog() {
    if (!this.external.reauthenticationDialog) {
      throw new Error("the reauthentication dialog is missing");
    }
  }

  waitForReferralFieldValue(value: string) {
    if (this.referralFieldValue !== value) {
      throw new Error("the completion referral field holds another value");
    }
  }

  waitForSelectedLanguage(locale: FakeLocale) {
    if (!this.languageListboxOpen) {
      throw new Error("the selected language check ran without a listbox");
    }
    if (this.languageValue !== locale) {
      throw new Error(`the selected language option is not ${locale}`);
    }
  }

  waitForProfilePanel() {
    if (this.selectedSection !== "profile") {
      throw new Error("the deep-linked profile panel is not shown");
    }
  }

  waitForReservationsPanel() {
    const userId = this.external.currentAuthUserId;
    const customerId = userId
      ? this.external.linksByUserId.get(userId)
      : undefined;
    if (!this.external.historyReady || !userId || !customerId) {
      throw new Error("the synthetic reservation history is not available");
    }
    if (this.pageText === supportTitle) {
      throw new Error("ambiguous account exposed reservation history");
    }
  }

  /**
   * The reservation groups the account page renders. The language case
   * seeds history without reservation fixtures, so it shows a fixed one.
   */
  private reservationSnapshot() {
    const reservations = this.external.reservations;
    if (reservations.length === 0) {
      return this.external.historyReady
        ? "Current and upcoming\nPast reservations\nCancelled"
        : "";
    }
    const hasStatus = (status: "CANCELLED" | "CONFIRMED") =>
      reservations.some((reservation) => reservation.status === status);
    return [
      "Current and upcoming",
      ...(hasStatus("CONFIRMED") ? ["Confirmed"] : []),
      "Past reservations",
      ...(hasStatus("CANCELLED") ? ["Cancelled"] : []),
    ].join("\n");
  }

  waitForSnapshot(matches: (snapshot: string) => boolean) {
    const snapshot = this.reservationSnapshot();
    if (!matches(snapshot)) {
      throw new Error(
        "the synthetic reservation snapshot assertion did not match"
      );
    }
    return snapshot;
  }

  url() {
    return this.currentUrl;
  }

  text() {
    return this.pageText;
  }
}

let activeExternal: FakeAccountExternalState | undefined;
let activeBrowser: FakeBrowser | undefined;

const requireExternal = () => {
  if (!activeExternal)
    throw new Error("synthetic account state is not installed");
  return activeExternal;
};

/** The cross-browser sign-in's second browser, open only inside its case. */
let assistantBrowser: FakeBrowser | undefined;
const assistantSession = `${session}-assistant`;

const requireBrowser = (browserSession = session) => {
  if (!activeBrowser) throw new Error("synthetic browser is not installed");
  if (browserSession === session) return activeBrowser;
  if (browserSession !== assistantSession) {
    throw new Error("the account case drove an unknown browser session");
  }
  if (!assistantBrowser) {
    assistantBrowser = new FakeBrowser(requireExternal(), true);
    requireExternal().assistantBrowserEvents.push("open");
  }
  return assistantBrowser;
};

/**
 * One account browser's page steps as domain operations over the fake
 * browser's state, resolved when each step runs; descriptions are ignored.
 */
const fakeAccountBrowser = (
  browser: () => FakeBrowser
): WorkspaceE2EAccountBrowser => ({
  open: (url) => Effect.sync(() => browser().open(url)),
  readText: Effect.sync(() => browser().text()),
  readUrl: Effect.sync(() => browser().url()),
  requestNewLinkAfterFailedCallback: (locale) =>
    Effect.sync(() => browser().requestNewLinkAfterFailedCallback(locale)),
  signOut: Effect.sync(() => browser().click(signOutSelector)),
  submitSignInEmail: (email) =>
    Effect.sync(() => {
      browser().fill(signInEmailSelector, email);
      browser().click(signInSubmitSelector);
    }),
  switchLocale: (locale) =>
    Effect.sync(() => {
      browser().switchLocale(locale);
      browser().waitForUrl((url) =>
        new URL(url).pathname.startsWith(`/${locale}`)
      );
    }),
  waitForCoworkSelection: (_description, entryTier) =>
    Effect.sync(() => browser().waitForCoworkSelection(entryTier)),
  waitForSignInCodeInput: Effect.sync(() =>
    browser().waitForHandler(signInCodeSelector, "onChange")
  ),
  waitForSignInForm: Effect.sync(() =>
    browser().waitForFormSubmitHandler(signInFormSelector, [
      signInEmailSelector,
    ])
  ),
  waitForText: (_description, matches) =>
    Effect.sync(() => browser().waitForText(matches)),
  waitForUrl: (_description, matches) =>
    Effect.sync(() => browser().waitForUrl(matches)),
});

mock.module("./auth-rows", () => ({
  assertNoAuthRows: (userId: string) =>
    Effect.sync(() => requireExternal().assertNoAuthRows(userId)),
  countAccountPasskeys: (userId: string) =>
    Effect.sync(() => requireExternal().passkeyCount(userId)),
  seedWorkspaceE2EReservationAuthor: () =>
    Effect.succeed("e2e-reservation-author"),
  findAuthUserIdByEmail: (email: string) =>
    Effect.sync(() => requireExternal().findAuthUserId(email)),
  findLinkedDotyposCustomerId: (userId: string) =>
    Effect.sync(() => requireExternal().findLinkedCustomerId(userId)),
  readNewestSessionCreatedAt: (userId: string) =>
    Effect.sync(() => requireExternal().usersById.get(userId)?.createdAt),
  removeSyntheticAccountLink: (accountId: string, customerId: string) =>
    Effect.sync(() =>
      requireExternal().removeAccountLink(accountId, customerId)
    ),
  setAccountLocalePreference: (userId: string, locale: "cs-CZ" | "en-US") =>
    Effect.sync(() => requireExternal().setLocalePreference(userId, locale)),
  setDeletionRequestedAt: (userId: string, value: Date | null) =>
    Effect.sync(() => requireExternal().setDeletionMarker(userId, value)),
  setSessionCreatedAt: (userId: string, value: Date) =>
    Effect.sync(() => requireExternal().setSessionCreatedAt(userId, value)),
}));

mock.module("./fixtures", () => ({
  assertNoSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    email: string
  ) => Effect.sync(() => requireExternal().assertNoProfile(email)),
  cancelSyntheticReservation: (
    _config: DatasourceConfig,
    reservationId: string
  ) => Effect.sync(() => requireExternal().cancelReservation(reservationId)),
  createSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    profile: { readonly email: string; readonly firstName: string }
  ) => Effect.sync(() => requireExternal().createProfile(profile)),
  createSyntheticReservation: (
    _config: DatasourceConfig,
    input: { readonly customerId: string }
  ) =>
    Effect.sync(() => ({
      endsAt: fixedNow,
      reservationId: requireExternal().createReservation(input.customerId),
      startsAt: fixedNow,
    })),
  expireSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    customerId: string
  ) => Effect.sync(() => requireExternal().expireProfile(customerId)),
  requireSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    customerId: string
  ) => Effect.sync(() => requireExternal().readProfile(customerId)),
}));

const realReferralFixtureModule = await import("./referral-fixture");

mock.module("./referral-fixture", () => ({
  ...realReferralFixtureModule,
  seedWorkspaceE2EReferralOwner: (input: {
    readonly accountId: string;
    readonly dotyposCustomerId: string;
    readonly email: string;
  }) => Effect.sync(() => requireExternal().seedReferralOwner(input)),
  findWorkspaceE2EReferralReferrer: (invitedDotyposCustomerId: string) =>
    Effect.sync(() =>
      requireExternal().referralAttributions.get(invitedDotyposCustomerId)
    ),
}));

const makeConfig = (): WorkspaceE2EAccountConfig => ({
  baseUrl,
  review: { baseUrl, screenshots: false },
  bypassSecret: undefined,
  expectedHost,
  locale: "en-US",
  runId: syntheticRunId as WorkspaceE2EAccountConfig["runId"],
  timeouts: workspaceE2ETimeouts,
  vercelProjectId: "workspace-e2e-project",
  vercelToken: "synthetic-vercel-log-token",
});

const makeScenario = (
  options: { readonly passkeys?: boolean; readonly signInCodes?: boolean } = {}
) => {
  const config = makeConfig();
  const mainRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EAccountMainRecipientLabel
  );
  const acceptedBRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-b"
  );
  const referralOwnerRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EReferralOwnerRecipientLabel
  );
  const external = new FakeAccountExternalState(
    config,
    mainRecipient,
    acceptedBRecipient,
    referralOwnerRecipient
  );
  external.signInCodes = options.signInCodes ?? false;
  external.passkeys = options.passkeys ?? false;
  const browser = new FakeBrowser(external);
  activeExternal = external;
  activeBrowser = browser;
  let journal = external.journal;
  const journalRef: WorkspaceE2EAccountJournalRef = {
    get journal() {
      return journal;
    },
    record: async (update) => {
      external.recordJournal(update);
      journal = external.journal;
    },
  };
  const lifecycleHandoff: WorkspaceE2EAccountLifecycleHandoff = {};
  const operations: MagicLinkOperation[] = [];
  const retries: string[] = [];
  const realBudget = makeMagicLinkRateBudget({
    now: () => fixedNowMs,
    retryAfterNotReady: () => {
      retries.push("retry");
      throw new Error("unexpected magic-link quiet-window retry");
    },
  });
  const rateBudget: MagicLinkRateBudget = {
    run: <A, E, R>(
      operation: MagicLinkOperation,
      effect: Effect.Effect<A, E, R>
    ) => {
      operations.push(operation);
      return realBudget.run(operation, effect);
    },
  };
  const previewLogs: WorkspaceE2EPreviewLogs = {
    listSyntheticLogEntryIds: (request) =>
      Effect.sync(() => external.listMessageIds(request.recipient)),
    retrieveMagicLink: (request) =>
      Effect.sync(
        () =>
          external.retrieveMessage(
            request.recipient,
            request.excludeLogEntryIds ?? [],
            request.startedAt
          ).link
      ),
    retrieveSignInEmail: (request) =>
      Effect.sync(() => {
        if (!external.signInCodes) {
          throw new Error("the synthetic sign-in email carries no code");
        }
        const { code, link } = external.retrieveMessage(
          request.recipient,
          request.excludeLogEntryIds ?? [],
          request.startedAt
        );
        return { code, link };
      }),
  };
  const datasourceConfig = {} as DatasourceConfig;
  const laneBrowser: WorkspaceE2EAccountLaneBrowser = {
    ...fakeAccountBrowser(() => browser),
    assistant: {
      ...fakeAccountBrowser(() => requireBrowser(assistantSession)),
      close: Effect.sync(() => {
        if (assistantBrowser) {
          assistantBrowser = undefined;
          external.assistantBrowserEvents.push("close");
        }
      }),
    },
    selectSection: (section) =>
      Effect.sync(() => browser.selectSection(section)),
    waitForNoRememberedReferralCode: Effect.sync(() => {
      if (browser.referralCookie !== undefined) {
        throw new Error("the lane browser still remembers a referral code");
      }
    }),
    waitForRememberedReferralCode: (code) =>
      Effect.sync(() => {
        if (browser.referralCookie !== code) {
          throw new Error("the lane browser remembers another referral code");
        }
      }),
    chooseBusinessBilling: Effect.sync(() => {
      browser.focus(billingKindSelector);
      browser.press("End");
      browser.press("Tab");
      browser.waitForBusinessBilling();
    }),
    chooseLanguage: (locale) =>
      Effect.sync(() => {
        browser.waitForHandler(
          `${accountSectionLandmarks.profile} ${languageTriggerSelector}`,
          "onPointerDown"
        );
        browser.click(languageTriggerSelector);
        browser.click(
          locale === "cs-CZ"
            ? languageOptionCsSelector
            : languageOptionEnSelector
        );
      }),
    confirmAccountDeletion: Effect.sync(() => {
      browser.click(deleteTriggerSelector);
      browser.waitForDeletionDialog();
      browser.click(deleteConfirmCheckboxSelector);
      browser.click(deleteConfirmSelector);
    }),
    dismissLanguageList: Effect.sync(() => {
      browser.press("Escape");
      return !browser.isLanguageListOpen();
    }),
    enterSignInCode: (code) =>
      Effect.sync(() => browser.fill(signInCodeSelector, code)),
    fillProfileField: (field, value) =>
      Effect.sync(() =>
        browser.fill(accountProfileFieldSelectors[field], value)
      ),
    hasLocaleCookie: (locale) =>
      Effect.sync(() => browser.hasLocaleCookie(locale)),
    openLanguageList: Effect.sync(() => browser.click(languageTriggerSelector)),
    readCompletionLoginEmail: (email) =>
      Effect.sync(() => browser.completionLoginEmail(email)),
    readLinkedLoginEmail: (email) =>
      Effect.sync(() => browser.linkedLoginEmail(email)),
    readProfileDrafts: (drafts) =>
      Effect.sync(() => browser.profileDrafts(drafts)),
    readSessionMatches: (email) =>
      Effect.sync(() => browser.sessionMatches(email)),
    readSignInEmailBlocked: Effect.sync(() => browser.signInEmailBlocked()),
    restartSignIn: (buttonLabel) =>
      Effect.sync(() => browser.restartSignIn(buttonLabel)),
    saveProfile: Effect.sync(() => browser.click(profileSubmitSelector)),
    sendReauthenticationLink: Effect.sync(() =>
      browser.click(deleteReauthSendSelector)
    ),
    setLocaleCookie: (locale) =>
      Effect.sync(() => browser.setLocaleCookie(locale)),
    waitForEmptiedSignInCode: Effect.sync(() =>
      browser.waitForEmptiedSignInCode()
    ),
    waitForLanguageControlLabel: (_description, label) =>
      Effect.sync(() => browser.waitForLanguageControlLabel(label)),
    waitForLinkedProfileForm: (submitLabel) =>
      Effect.sync(() => browser.waitForLinkedProfileForm(submitLabel)),
    waitForPageHeading: (_description, heading) =>
      Effect.sync(() => browser.waitForHeading(heading)),
    waitForProfilePanel: () => Effect.sync(() => browser.waitForProfilePanel()),
    waitForReauthenticationDialog: Effect.sync(() =>
      browser.waitForReauthenticationDialog()
    ),
    waitForReferralFieldValue: (_description, code) =>
      Effect.sync(() => browser.waitForReferralFieldValue(code)),
    waitForReservationsPanel: () =>
      Effect.sync(() => browser.waitForReservationsPanel()),
    waitForSelectedLanguage: (_description, locale) =>
      Effect.sync(() => browser.waitForSelectedLanguage(locale)),
    waitForSnapshot: (_description, matches) =>
      Effect.sync(() => browser.waitForSnapshot(matches)),
  };
  const passkeys: WorkspaceE2EAccountPasskeys = {
    confirmDeletionWithPasskey: Effect.sync(() =>
      external.confirmDeletionWithPasskey()
    ),
    createFromPrompt: Effect.sync(() => external.createPasskeyFromPrompt()),
    createFromSettings: Effect.sync(() => external.createPasskeyFromSettings()),
    deleteOnly: (name) => Effect.sync(() => external.deletePasskey(name)),
    installAuthenticator: Effect.sync(() => external.addAuthenticator()),
    readAuthenticatorCredentials: Effect.sync(() =>
      external.readAuthenticatorCredentials()
    ),
    readSignInOffer: Effect.sync(() =>
      external.passkeys ? ("offered" as const) : ("absent" as const)
    ),
    removeAuthenticator: Effect.sync(() => external.removeAuthenticator()),
    renameOnly: (name) => Effect.sync(() => external.renamePasskey(name)),
    signIn: Effect.sync(() => {
      if (!browser.url().includes("/auth/sign-in")) {
        throw new Error("the passkey button was used off the sign-in page");
      }
      external.signInWithPasskey();
      browser.open(`${config.baseUrl}/en-US/account`);
    }),
  };

  return {
    browser,
    config,
    datasourceConfig,
    external,
    journalRef,
    laneBrowser,
    lifecycleHandoff,
    operations,
    passkeys,
    previewLogs,
    rateBudget,
    retries,
  };
};

const rejectUnexpectedHttp = Object.assign(
  async (..._args: Parameters<typeof fetch>) => {
    throw new Error("HTTP must not execute");
  },
  {
    preconnect: (..._args: Parameters<typeof fetch.preconnect>) => undefined,
  }
);

const httpClientLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.Fetch, rejectUnexpectedHttp))
);

const accountCaseTestLayer = Layer.mergeAll(
  makeE2ETelemetryMock([]),
  Layer.succeed(E2EDatabase, E2EDatabase.of({ db: {} as never })),
  httpClientLayer
);

const makeCaseExecution = (
  testCase: WorkspaceE2EAccountCase,
  scenario: ReturnType<typeof makeScenario>,
  stepIds: string[],
  verifyPage?: WorkspaceE2EStep<void>
): Effect.Effect<void, WorkspaceE2EError> => {
  const runStep: WorkspaceE2EStepRunner = <A, R>(
    step: WorkspaceE2EStep<A, R>
  ) => {
    stepIds.push(step.id);
    // Deliberately return the implementation's Effect unchanged. The fake
    // boundary models its dependencies; it does not replace semantic steps.
    return step.execute;
  };
  return Effect.acquireUseRelease(
    Effect.interruptible(
      testCase.execute({
        journalRef: scenario.journalRef,
        runStep,
        session,
      })
    ),
    () =>
      Option.match(Option.fromNullishOr(verifyPage), {
        onNone: () => Effect.void,
        onSome: runStep,
      }),
    (completion, useExit) =>
      completion.cleanup.pipe(
        Effect.exit,
        Effect.flatMap((cleanupExit) =>
          Exit.match(useExit, {
            onFailure: () => Effect.void,
            onSuccess: () =>
              Exit.match(cleanupExit, {
                onFailure: (cause) => Effect.failCause(cause),
                onSuccess: () => Effect.void,
              }),
          })
        )
      )
  ).pipe(Effect.provide(accountCaseTestLayer));
};

const executeCase = async (
  testCase: WorkspaceE2EAccountCase,
  scenario: ReturnType<typeof makeScenario>,
  stepIds: string[],
  verifyPage?: WorkspaceE2EStep<void>
) =>
  Effect.runPromise(makeCaseExecution(testCase, scenario, stepIds, verifyPage));

const { makeWorkspaceE2ESignInReturns } = await import("./cases");

const buildCase = async (
  makeCases: typeof import("./cases").makeWorkspaceE2EAccountCases,
  caseId: WorkspaceE2EAccountCaseId,
  scenario: ReturnType<typeof makeScenario>,
  options: { readonly captureLanguageReview?: boolean } = {}
) => {
  const cases = makeCases({
    ...(options.captureLanguageReview
      ? {
          captureLanguagePreferenceReview: async (stage: string) => {
            requireBrowser().captureLanguageReview(stage);
          },
        }
      : {}),
    config: scenario.config,
    datasourceConfig: scenario.datasourceConfig,
    laneBrowser: scenario.laneBrowser,
    lifecycleHandoff: scenario.lifecycleHandoff,
    passkeys: scenario.passkeys,
    previewLogs: scenario.previewLogs,
    captureSignInHandoffReview: async (stage) => {
      scenario.external.signInHandoffReviews.push({
        stage,
        url: requireBrowser(assistantSession).url(),
      });
    },
    rateBudget: scenario.rateBudget,
    signInReturns: makeWorkspaceE2ESignInReturns(fixedNowMs),
  });
  const selected = cases.find(({ id }) => id === caseId);
  if (!selected) throw new Error(`case ${caseId} was not built`);
  return selected;
};

afterEach(() => {
  activeExternal = undefined;
  activeBrowser = undefined;
  assistantBrowser = undefined;
  setSystemTime();
});

/**
 * Runs every catalog case in lane order against one real budget whose
 * quiet-window retry throws, so an operation any case spends beyond the lane
 * budget fails, declared or not. A case the lane skips on this preview spends
 * nothing.
 */
const runLane = async (
  scenario: ReturnType<typeof makeScenario>,
  stepIds: string[]
) => {
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const operationsByCase: Partial<
    Record<WorkspaceE2EAccountCaseId, readonly MagicLinkOperation[]>
  > = {};
  const skippedCaseIds: WorkspaceE2EAccountCaseId[] = [];
  for (const caseId of workspaceE2EAccountCaseIds) {
    if (
      workspaceE2EAccountCaseSkipReason(caseId, scenario.lifecycleHandoff) !==
      undefined
    ) {
      skippedCaseIds.push(caseId);
      operationsByCase[caseId] = [];
      continue;
    }
    const selected = await buildCase(
      makeWorkspaceE2EAccountCases,
      caseId,
      scenario
    );
    const operationsBefore = scenario.operations.length;
    await executeCase(selected, scenario, stepIds);
    operationsByCase[caseId] = scenario.operations.slice(operationsBefore);
  }
  // A failed case's annotation names its terminal step only when the
  // production formatter keeps the step id.
  for (const stepId of stepIds) {
    expect(
      formatWorkspaceE2EFailureAnnotation({
        caseId: "account-anonymous-redirect",
        failureKind: "error",
        outcome: "failed",
        stepId,
      })
    ).toContain(`,step=${stepId},`);
  }
  return { operationsByCase, skippedCaseIds };
};

test("executes every account lane case within the magic-link ledger", async () => {
  setSystemTime(fixedNow);
  const scenario = makeScenario();
  const stepIds: string[] = [];
  const { operationsByCase, skippedCaseIds } = await runLane(scenario, stepIds);

  expect(stepIds.length).toBeGreaterThan(0);
  // Without sign-in codes the form shows the inbox notice, and without
  // passkeys it offers no passkey sign-in, so the lane skips the code and
  // passkey cases before they touch anything.
  expect(scenario.lifecycleHandoff.signInConfirmation).toBe("inbox");
  expect(scenario.lifecycleHandoff.passkeySignIn).toBe("absent");
  expect(skippedCaseIds).toEqual([
    "account-sign-in-code",
    "account-passkey-sign-in",
    "account-passkey-management",
  ]);
  expect(scenario.external.passkeyActions).toEqual([]);
  expect(scenario.lifecycleHandoff.firstAcceptedRequestedAt).toEqual(fixedNow);
  expect(scenario.lifecycleHandoff.referralInvitation).toEqual({
    code: syntheticReferralCode,
    referrerCustomerId: referralOwnerCustomerId,
  });

  // The referrer exists before any sign-in request, and the first accepted
  // request starts anonymously from the locale-free share link: no direct
  // sign-in page visit precedes it.
  const firstSendIndex = scenario.external.events.findIndex(
    ({ type }) => type === "send"
  );
  expect(
    scenario.external.events.findIndex(
      ({ type }) => type === "referral-owner-seed"
    )
  ).toBeLessThan(firstSendIndex);
  expect(scenario.external.referralOwnerSeeds).toEqual([
    {
      accountId: expect.stringMatching(/^account-referral-owner-/),
      dotyposCustomerId: referralOwnerCustomerId,
      email: scenario.external.referralOwnerRecipient,
    },
  ]);
  const firstSendClick = scenario.external.browserActions.findIndex(
    ({ kind, selectorOrDestination }) =>
      kind === "click" && selectorOrDestination === signInSubmitSelector
  );
  expect(
    scenario.external.browserActions
      .slice(0, firstSendClick)
      .filter(({ kind }) => kind === "open")
      .map(({ selectorOrDestination }) => selectorOrDestination)
  ).toEqual(["/account"]);

  // Each case spent exactly its ledger entry, so an undeclared operation
  // fails even while the lane total still fits the budget.
  expect(scenario.retries).toEqual([]);
  expect(Object.keys(operationsByCase)).toEqual([
    ...workspaceE2EAccountCaseIds,
  ]);
  expect(operationsByCase).toEqual(workspaceE2EAccountMagicLinkLedger);
  // The reauthentication sign-in landed on the fixture-saved Czech site, and
  // English (US) was restored before the deletion; the Czech cross-browser
  // sign-in saved Čeština, which the fixture restored to English (US); the
  // locale case then saved Čeština and switched back to English (US) for the
  // linking case.
  expect(scenario.external.fixtureLocaleWrites).toEqual([
    "cs-CZ",
    "en-US",
    "en-US",
  ]);
  // The assistant's browser requested the reactivation link from the Czech
  // cowork selection, replayed it after the lane browser consumed it, kept
  // its return target on the new-link sign-in, and closed with the case.
  const signInReturns = makeWorkspaceE2ESignInReturns(fixedNowMs);
  // The main recipient's first link returned the lane browser to its
  // English selection, and the reactivation link to the assistant's Czech
  // one; the reauthentication link kept its account landing.
  expect(scenario.external.linkLandings).toEqual([
    signInReturns.sameBrowser.returnTo,
    "/en-US/account",
    signInReturns.assistant.returnTo,
  ]);
  expect(scenario.external.assistantBrowserEvents).toEqual(["open", "close"]);
  expect(
    scenario.external.signInHandoffReviews.map(({ stage, url }) => {
      const parsed = new URL(url);
      return [stage, parsed.pathname, parsed.searchParams.get("error")];
    })
  ).toEqual([
    ["sign-in-accepted", "/cs-CZ/auth/sign-in", null],
    ["callback-failed", "/cs-CZ/auth/callback", "INVALID_TOKEN"],
  ]);
  expect(
    new URL(
      scenario.external.signInHandoffReviews[0]?.url ?? ""
    ).searchParams.get("returnTo")
  ).toBe(signInReturns.assistant.returnTo);
  expect(scenario.external.languageSaves).toEqual(["cs-CZ", "en-US"]);
  expect(scenario.external.localePreference).toBe("en-US");
  expect(stepIds).toContain("sign-in-onto-saved-czech-site");

  const operationEvents = scenario.external.events.filter(({ type }) =>
    ["send", "receive", "logout", "consume", "deletion", "replay"].includes(
      type
    )
  );
  expect(
    operationEvents.map(({ kind, type }) => `${type}:${kind ?? ""}`)
  ).toEqual([
    "send:initial-main",
    "send:accepted-b",
    "receive:initial-main",
    "consume:initial-main",
    "send:reauthentication",
    "receive:reauthentication",
    "logout:",
    "consume:reauthentication",
    "deletion:",
    "send:reactivation",
    "receive:reactivation",
    "consume:reactivation",
    "replay:",
  ]);

  const mainMessages =
    scenario.external.messagesByRecipient.get(
      scenario.external.mainRecipient
    ) ?? [];
  expect(mainMessages.map(({ kind }) => kind)).toEqual([
    "initial-main",
    "reauthentication",
    "reactivation",
  ]);
  // The shared code travels in the remembered cookie, never in a link, and
  // the completed profile records the referral, which uses up the cookie.
  expect(mainMessages.some(({ link }) => link.includes("ref"))).toBe(false);
  expect(scenario.external.referralAttributions).toEqual(
    new Map([["customer-retained", referralOwnerCustomerId]])
  );
  expect(scenario.browser.referralCookie).toBeUndefined();
  expect(mainMessages[0]?.consumed).toBe(true);
  expect(mainMessages[1]?.consumed).toBe(true);
  expect(mainMessages[2]?.consumed).toBe(true);
  const acceptedBMessages =
    scenario.external.messagesByRecipient.get(
      scenario.external.acceptedBRecipient
    ) ?? [];
  expect(acceptedBMessages).toHaveLength(1);
  expect(acceptedBMessages[0]?.kind).toBe("accepted-b");
  expect(acceptedBMessages[0]?.consumed).toBe(false);
  expect(
    scenario.external.usersByEmail.has(scenario.external.acceptedBRecipient)
  ).toBe(false);
  expect(scenario.external.retrieveCalls).toEqual([
    {
      excludeLogEntryIds: [],
      recipient: scenario.external.mainRecipient,
    },
    {
      excludeLogEntryIds: [mainMessages[0]?.id ?? ""],
      recipient: scenario.external.mainRecipient,
    },
    {
      excludeLogEntryIds: [
        mainMessages[0]?.id ?? "",
        mainMessages[1]?.id ?? "",
      ],
      recipient: scenario.external.mainRecipient,
    },
  ]);

  expect(scenario.external.reauthenticationObservations).toEqual([
    {
      linkedCustomerId: "customer-retained",
      marker: true,
      userId: "auth-original",
    },
  ]);
  expect(scenario.external.reauthenticationDialog).toBe(true);
  expect(scenario.lifecycleHandoff.reauthentication).toMatchObject({
    linkedCustomerId: "customer-retained",
    userId: "auth-original",
  });
  expect(scenario.lifecycleHandoff.reauthentication?.link).toBe(
    mainMessages[1]?.link
  );
  expect(scenario.lifecycleHandoff.deletedUserId).toBe("auth-original");
  expect(scenario.lifecycleHandoff.retainedCustomerId).toBe(
    "customer-retained"
  );

  expect(scenario.external.deletionObservations).toEqual([
    {
      authRowPresent: false,
      customerId: "customer-retained",
      linkPresent: false,
      profileDeleted: false,
      profileExpired: true,
      sessionPresent: false,
      userId: "auth-original",
    },
  ]);
  expect(scenario.external.reactivationObservations).toEqual([
    {
      customerId: "customer-retained",
      historyPresent: true,
      userId: "auth-reactivated",
    },
  ]);
  expect(scenario.external.createdAuthIds).toEqual([
    "auth-original",
    "auth-reactivated",
  ]);

  expect(scenario.external.unlinkObservations).toEqual([
    {
      accountId: "auth-reactivated",
      customerId: "customer-retained",
      precedingDestination: "/contact",
    },
    {
      accountId: "auth-reactivated",
      customerId: "customer-retained",
      precedingDestination: "/contact",
    },
    {
      accountId: "auth-reactivated",
      customerId: "customer-retained",
      precedingDestination: "/contact",
    },
  ]);
  // The reactivated account claims its retained profile when the account
  // page opens after the selection, not when the link is consumed.
  expect(
    scenario.external.events
      .filter(({ type }) => type === "relink")
      .map(({ mode }) => mode)
  ).toEqual(["expired", "active", "expired"]);
  expect(
    scenario.external.events.filter(({ type }) => type === "ambiguity")
  ).toHaveLength(1);

  const duplicateJournal = scenario.external.journalSnapshots.find(
    ({ journal }) => journal.dotyposCustomerIds.includes("customer-duplicate-1")
  );
  const ambiguityEventIndex = scenario.external.events.findIndex(
    ({ type }) => type === "ambiguity"
  );
  expect(duplicateJournal).toBeDefined();
  expect(ambiguityEventIndex).toBeGreaterThan(-1);
  // A journal snapshot records the insertion point for the next event, so an
  // equal index still proves it was persisted before the ambiguity navigation.
  expect(duplicateJournal?.eventIndex).toBeLessThanOrEqual(ambiguityEventIndex);
  expect(scenario.external.journal.authUserIds).toEqual([
    scenario.external.referralOwnerSeeds[0]?.accountId,
    "auth-original",
    "auth-reactivated",
  ]);
  expect(scenario.external.journal.dotyposCustomerIds).toEqual([
    referralOwnerCustomerId,
    "customer-retained",
    "customer-duplicate-1",
  ]);
  expect(scenario.external.journal.dotyposReservationIds).toEqual([
    "reservation-1",
    "reservation-2",
  ]);
});

test("signs in with an emailed code and keeps every link journey when sign-in codes are on", async () => {
  setSystemTime(fixedNow);
  const scenario = makeScenario({ signInCodes: true });
  const stepIds: string[] = [];
  const { operationsByCase, skippedCaseIds } = await runLane(scenario, stepIds);

  expect(scenario.lifecycleHandoff.signInConfirmation).toBe("code");
  expect(skippedCaseIds).toEqual([
    "account-passkey-sign-in",
    "account-passkey-management",
  ]);
  // The code sign-in reuses the second unknown email, so the magic-link
  // ledger is unchanged.
  expect(scenario.retries).toEqual([]);
  expect(operationsByCase).toEqual(workspaceE2EAccountMagicLinkLedger);
  expect(stepIds).toContain("sign-in-with-emailed-code");

  const operationEvents = scenario.external.events.filter(({ type }) =>
    [
      "send",
      "receive",
      "logout",
      "consume",
      "code-rejected",
      "consume-code",
      "deletion",
      "replay",
    ].includes(type)
  );
  expect(
    operationEvents.map(({ kind, type }) => `${type}:${kind ?? ""}`)
  ).toEqual([
    "send:initial-main",
    "send:accepted-b",
    "receive:accepted-b",
    "code-rejected:",
    "consume-code:accepted-b",
    "logout:",
    "receive:initial-main",
    "consume:initial-main",
    "send:reauthentication",
    "receive:reauthentication",
    "logout:",
    "consume:reauthentication",
    "deletion:",
    "send:reactivation",
    "receive:reactivation",
    "consume:reactivation",
    "replay:",
  ]);
  // The second request switched email from the main recipient's code step.
  expect(
    scenario.external.browserActions.filter(
      ({ kind, selectorOrDestination }) =>
        kind === "click" &&
        selectorOrDestination.includes(useDifferentEmailLabel)
    )
  ).toHaveLength(1);
  // The deletion dialog's code step still hands its link to the session
  // lifecycle, which signs back in with it.
  expect(scenario.lifecycleHandoff.reauthentication?.link).toBe(
    scenario.external.messagesByRecipient.get(
      scenario.external.mainRecipient
    )?.[1]?.link
  );
  expect(scenario.external.createdAuthIds).toEqual([
    "auth-accepted-b",
    "auth-original",
    "auth-reactivated",
  ]);
  expect(scenario.external.journal.authUserIds).toEqual([
    scenario.external.referralOwnerSeeds[0]?.accountId,
    "auth-accepted-b",
    "auth-original",
    "auth-reactivated",
  ]);
  // The code account never took the share code the main account follows.
  expect(scenario.external.referralAttributions).toEqual(
    new Map([["customer-retained", referralOwnerCustomerId]])
  );
});

test("creates, signs in with, manages, and reauthenticates with a passkey when passkeys are on", async () => {
  setSystemTime(fixedNow);
  const scenario = makeScenario({ passkeys: true, signInCodes: true });
  const stepIds: string[] = [];
  const { operationsByCase, skippedCaseIds } = await runLane(scenario, stepIds);

  expect(scenario.lifecycleHandoff.passkeySignIn).toBe("offered");
  expect(skippedCaseIds).toEqual([]);
  // Every passkey journey reuses the reactivation sign-in, so the
  // magic-link ledger is unchanged.
  expect(scenario.retries).toEqual([]);
  expect(operationsByCase).toEqual(workspaceE2EAccountMagicLinkLedger);
  // The authenticator is present before the reactivation link lands, so the
  // prompt creates the first passkey; the passkey cases then sign in with it,
  // rename and delete it, create another from settings, confirm the
  // stale-session deletion with it, and remove the authenticator.
  expect(scenario.external.passkeyActions).toEqual([
    "add-authenticator",
    "create-from-prompt",
    "sign-in",
    "rename",
    "delete",
    "create-from-settings",
    "confirm-deletion",
    "remove-authenticator",
  ]);
  expect(stepIds.indexOf("add-virtual-passkey-authenticator")).toBeLessThan(
    stepIds.indexOf("reactivate-retained-profile")
  );
  expect(stepIds).toContain("create-passkey-from-prompt");
  // The account survives the passkey confirmation and keeps one passkey.
  expect(scenario.external.passkeysByUserId).toEqual(
    new Map([["auth-reactivated", 1]])
  );
  expect(
    scenario.external.events.filter(({ type }) => type === "deletion")
  ).toHaveLength(1);
  // The locale case still ran on the passkey session afterwards.
  expect(scenario.external.languageSaves).toEqual(["cs-CZ", "en-US"]);
});

test("fails closed before retrieving a code when the sign-in form showed no code step", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario({ signInCodes: true });
  scenario.lifecycleHandoff.signInConfirmation = "inbox";
  scenario.lifecycleHandoff.secondAcceptedRequestedAt = fixedNow;
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-sign-in-code",
    scenario
  );

  await expect(executeCase(selected, scenario, [])).rejects.toThrow(
    "the sign-in form did not open the code step"
  );
  expect(scenario.external.retrieveCalls).toEqual([]);
  expect(scenario.external.browserActions).toEqual([]);
});

test("fails closed before external side effects when the accepted request handoff is missing", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-magic-link-delivery",
    scenario
  );
  const stepIds: string[] = [];
  const exit = await Effect.runPromiseExit(
    makeCaseExecution(selected, scenario, stepIds)
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toEqual(["require-first-accepted-request-handoff"]);
  expect(scenario.external.browserActions).toEqual([]);
  expect(scenario.external.events).toEqual([]);
  expect(scenario.external.authReads).toEqual([]);
  expect(scenario.external.providerCalls).toEqual([]);
  expect(scenario.external.listCalls).toEqual([]);
  expect(scenario.external.retrieveCalls).toEqual([]);
  expect(scenario.operations).toEqual([]);
  expect(scenario.retries).toEqual([]);
});

test("fails closed before any sign-in request when the share-link handoff is missing", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-sign-in-form",
    scenario
  );
  const stepIds: string[] = [];
  const exit = await Effect.runPromiseExit(
    makeCaseExecution(selected, scenario, stepIds)
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toEqual(["require-share-link-sign-in-handoff"]);
  expect(scenario.external.browserActions).toEqual([]);
  expect(scenario.external.events).toEqual([]);
  expect(scenario.operations).toEqual([]);
  expect(scenario.lifecycleHandoff.firstAcceptedRequestedAt).toBeUndefined();
});

test("fails closed before external side effects when the reauthentication handoff is missing", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-session-lifecycle",
    scenario
  );
  const stepIds: string[] = [];
  const exit = await Effect.runPromiseExit(
    makeCaseExecution(selected, scenario, stepIds)
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toEqual(["require-reauthentication-handoff"]);
  expect(scenario.external.browserActions).toEqual([]);
  expect(scenario.external.events).toEqual([]);
  expect(scenario.external.authReads).toEqual([]);
  expect(scenario.external.providerCalls).toEqual([]);
  expect(scenario.external.listCalls).toEqual([]);
  expect(scenario.external.retrieveCalls).toEqual([]);
  expect(scenario.operations).toEqual([]);
  expect(scenario.retries).toEqual([]);
});

test("fails when the reauthentication handoff names a different linked customer", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  const link = scenario.external.seedPendingReauthenticationForTest();
  scenario.lifecycleHandoff.reauthentication = {
    link,
    linkedCustomerId: "customer-wrong",
    userId: "auth-original",
  };
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-session-lifecycle",
    scenario
  );
  const stepIds: string[] = [];
  const exit = await Effect.runPromiseExit(
    makeCaseExecution(selected, scenario, stepIds)
  );

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toContain("sign-in-onto-saved-czech-site");
  expect(scenario.external.createdAuthIds).toEqual(["auth-original"]);
  expect(scenario.external.deletionObservations).toEqual([]);
  expect(scenario.external.reauthenticationObservations).toEqual([
    {
      linkedCustomerId: "customer-retained",
      marker: true,
      userId: "auth-original",
    },
  ]);
  expect(scenario.operations).toEqual(["verify"]);
  expect(scenario.retries).toEqual([]);
});

const seedLanguageAccount = (external: FakeAccountExternalState): FakeUser => {
  // The lane reaches the language case with an onboarded, linked account
  // whose reservation history is already provisioned, still signed in from
  // the reactivation sign-in. The account was created under en-US, so
  // English (US) is saved.
  const seedUser = {
    createdAt: fixedNow,
    deletionRequestedAt: null,
    email: external.mainRecipient,
    id: "auth-original",
    session: true,
  } satisfies FakeUser;
  external.usersById.set(seedUser.id, seedUser);
  external.usersByEmail.set(seedUser.email, seedUser);
  const seedProfile = {
    companyName: null,
    deleted: false,
    email: external.mainRecipient,
    expireDate: null,
    firstName: "E2E",
    id: "customer-language",
    lastName: "",
    phone: "",
  } satisfies FakeProfile;
  external.profiles.set(seedProfile.id, seedProfile);
  external.linksByUserId.set(seedUser.id, seedProfile.id);
  external.currentAuthUserId = seedUser.id;
  external.historyReady = true;
  return seedUser;
};

const runLanguageCase = async (
  configure: (external: FakeAccountExternalState) => void = () => undefined,
  options: { readonly captureLanguageReview?: boolean } = {}
) => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  seedLanguageAccount(scenario.external);
  // The previous case leaves the English account open.
  scenario.browser.startAt(`${baseUrl}/en-US/account`);
  configure(scenario.external);
  const selected = await buildCase(
    makeWorkspaceE2EAccountCases,
    "account-locale-preference",
    scenario,
    options
  );
  const stepIds: string[] = [];
  const runStep: WorkspaceE2EStepRunner = <A, R>(
    step: WorkspaceE2EStep<A, R>
  ) => {
    stepIds.push(step.id);
    return step.execute;
  };
  const exit = await Effect.runPromiseExit(
    selected.execute({
      journalRef: scenario.journalRef,
      runStep,
      session,
    }) as Effect.Effect<void, WorkspaceE2EError>
  );
  return { exit, scenario, stepIds };
};

const languageCaseStepIds = [
  "open-english-profile",
  "choose-czech-language",
  "assert-czech-selected",
  "redirect-conflicting-locale-to-czech",
  "assert-czech-selected-after-redirect",
  "switch-to-english-in-header",
  "redirect-czech-url-to-english",
  "assert-english-saved-after-switch",
];

test("makes the saved language preference the site locale and switches it back from the header", async () => {
  const { exit, scenario, stepIds } = await runLanguageCase();
  const external = scenario.external;

  expect(Exit.isSuccess(exit)).toBe(true);
  // The case reuses the lane's signed-in session and spends no magic link.
  expect(scenario.operations).toEqual([]);
  expect(scenario.retries).toEqual([]);
  // Choosing Čeština in the profile saved it once, and the header switch
  // saved English (US) back.
  expect(external.languageSaves).toEqual(["cs-CZ", "en-US"]);
  expect(external.switcherSaves).toEqual(["en-US"]);
  expect(external.localePreference).toBe("en-US");
  expect(stepIds).toEqual(languageCaseStepIds);
  // The en-US probes were requested and redirected by the preference.
  const opened = external.browserActions
    .filter(({ kind }) => kind === "open")
    .map(({ selectorOrDestination }) => selectorOrDestination);
  expect(opened).toContain("/en-US/faq");
  expect(opened).toContain("/cs-CZ/account");
  // Later serial cases start from the English account, signed in.
  expect(requireBrowser().url()).toBe(`${baseUrl}/en-US/account/profile`);
  expect(external.currentAuthUserId).toBe("auth-original");
  // Without a review hook nothing is captured.
  expect(external.languageReviews).toEqual([]);
});

test("presses Escape again when the language listbox missed the first one", async () => {
  const { exit, scenario, stepIds } = await runLanguageCase((external) => {
    external.listboxMissesFirstEscape = true;
  });

  expect(Exit.isSuccess(exit)).toBe(true);
  // The header switch still saved English (US) instead of being swallowed
  // by a listbox left open.
  expect(scenario.external.switcherSaves).toEqual(["en-US"]);
  expect(stepIds).toEqual(languageCaseStepIds);
});

test("rejects a proxy that lets the URL locale outrank the saved preference", async () => {
  const { exit, scenario, stepIds } = await runLanguageCase((external) => {
    external.preferenceRedirects = false;
  });

  expect(Exit.isFailure(exit)).toBe(true);
  // The Czech save still navigates to Czech, but the conflicting en-US URL
  // and cookie keep the English page.
  expect(stepIds.at(-1)).toBe("redirect-conflicting-locale-to-czech");
  expect(scenario.external.localePreference).toBe("cs-CZ");
});

test("rejects a header switch that does not save the preference", async () => {
  const { exit, scenario, stepIds } = await runLanguageCase((external) => {
    external.switcherSavesPreference = false;
  });

  expect(Exit.isFailure(exit)).toBe(true);
  // A plain link is redirected straight back to the saved Czech locale.
  expect(stepIds.at(-1)).toBe("switch-to-english-in-header");
  expect(scenario.external.switcherSaves).toEqual([]);
  expect(scenario.external.localePreference).toBe("cs-CZ");
});

test("rejects a Czech save that the saved preference does not keep", async () => {
  const { exit, stepIds } = await runLanguageCase((external) => {
    const save = external.saveLocalePreference.bind(external);
    // The profile save reports success but persists nothing, so the
    // proxy sends the Czech navigation straight back to English (US).
    external.saveLocalePreference = (locale) => {
      external.languageSaves.push(locale);
      if (external.languageSaves.length > 1) save(locale);
    };
  });

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds.at(-1)).toBe("choose-czech-language");
});
