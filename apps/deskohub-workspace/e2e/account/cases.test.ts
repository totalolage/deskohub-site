import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import type { Customer } from "@deskohub/dotypos/generated";
import { Effect, Exit } from "effect";
import { betterAuthMagicLinkOptions } from "@/features/account/backend/auth/auth-options";
import type { DatasourceConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import type { BrowserCommandResult, Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import type { WorkspaceE2EStep, WorkspaceE2EStepRunner } from "../types";
import {
  type WorkspaceE2EAccountCaseId,
  workspaceE2EAccountCaseIds,
} from "./catalog";
import {
  makeWorkspaceE2EAccountRecipient,
  type WorkspaceE2EAccountConfig,
  workspaceE2EAccountMainRecipientLabel,
} from "./config";
import type { WorkspaceE2EAccountJournal } from "./journal";
import {
  type MagicLinkOperation,
  type MagicLinkRateBudget,
  magicLinkOperationsPerWindow,
  magicLinkOperationWindowMs,
  makeMagicLinkRateBudget,
} from "./rate-budget";
import type {
  WorkspaceE2EAccountCase,
  WorkspaceE2EAccountJournalRef,
  WorkspaceE2EAccountLifecycleHandoff,
} from "./types";

const fixedNow = new Date("2026-09-11T12:00:00.000Z");
const fixedNowMs = fixedNow.getTime();
const baseUrl = "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app";
const expectedHost = new URL(baseUrl).host;
const syntheticRunId = "cases-test-run";
const session = "workspace-account-cases-test";

const acceptedTitle = "Check your inbox";
const acceptedBody =
  "If the address can receive mail, a single-use link will arrive shortly. The link works once and expires in 10 minutes.";
const completionTitle = "Complete your profile";
const deletionPendingTitle = "Account deletion is pending";
const deletionReauthLinkSent =
  "If the address can receive mail, a new link is on its way.";
const deletedTitle = "Your account was deleted";
const callbackFailedTitle = "This link cannot be used";
const supportTitle = "We need to verify your profile";
const signInFormSelector = "#account-sign-in-form";
const signInEmailSelector = "#account-sign-in-email";
const signInSubmitSelector = "#account-sign-in-submit";
const signOutSelector = "#account-sign-out";
const deleteTriggerSelector = "#delete-account-trigger";
const deleteReauthSendSelector = "#delete-account-reauth-send";
const deleteConfirmCheckboxSelector = "#confirm-account-deletion";
const deleteConfirmSelector = "#delete-account-confirm";

const selectedCaseIds = [
  "account-sign-in-form",
  "account-magic-link-delivery",
  "account-deletion-marker-reauth",
  "account-session-lifecycle",
  "account-deletion-and-reactivation",
  "account-linking-variants",
] as const satisfies readonly WorkspaceE2EAccountCaseId[];

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
  readonly recipient: string;
  consumed: boolean;
};

type FakeProfile = {
  readonly companyName: string | null;
  deleted: boolean;
  expireDate: string | null;
  readonly firstName: string;
  readonly id: string;
  readonly email: string;
  readonly lastName: string;
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
    | "provider-expire"
    | "provider-reactivate"
    | "provider-create";
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
  readonly text: string;
};

/**
 * A stateful, provider-shaped boundary for the account case factory. The
 * profile and reservation history seed is intentionally explicit: those two
 * catalog cases remain covered by their own browser tests, while this test
 * starts the lifecycle lane immediately after their successful postcondition.
 */
class FakeAccountExternalState {
  readonly acceptedResponses: string[] = [];
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
    readonly excludedMessageIds: readonly string[];
    readonly recipient: string;
  }> = [];
  readonly unlinkObservations: UnlinkObservation[] = [];
  readonly authReads: string[] = [];
  readonly providerCalls: string[] = [];
  readonly messagesByRecipient = new Map<string, FakeMessage[]>();
  readonly profiles = new Map<string, FakeProfile>();
  readonly usersByEmail = new Map<string, FakeUser>();
  readonly usersById = new Map<string, FakeUser>();
  readonly linksByUserId = new Map<string, string>();
  readonly consumedLinks = new Set<string>();

  currentAuthUserId: string | undefined;
  historyReady = false;
  profileHistorySeeded = false;
  lastDestination = "";
  staleSession = false;
  deletionDialog = false;
  deletionConfirmationChecked = false;
  reauthenticationDialog = false;
  private messageSequence = 0;
  private duplicateProfileSequence = 0;
  private deletedIdentity = false;

  constructor(
    readonly config: WorkspaceE2EAccountConfig,
    readonly mainRecipient: string,
    readonly acceptedBRecipient: string
  ) {}

  recordBrowserAction(action: FakeBrowserAction) {
    this.browserActions.push(action);
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

  seedCompletedProfileAndHistory() {
    const original = this.usersById.get("auth-original");
    if (!original)
      throw new Error("the synthetic magic link did not create auth");

    const retained = this.makeProfile({
      email: this.mainRecipient,
      firstName: "E2E",
      id: "customer-retained",
    });
    this.profiles.set(retained.id, retained);
    this.linksByUserId.set(original.id, retained.id);
    this.historyReady = true;
    this.profileHistorySeeded = true;
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
    this.duplicateProfileSequence += 1;
    const customerId = `customer-duplicate-${this.duplicateProfileSequence}`;
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

  sendMessage(email: string, kind: "sign-in" | "reauthentication") {
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
    const message = this.makeMessage(email, messageKind);
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
    excludedMessageIds: readonly string[],
    startedAt: Date
  ) {
    this.retrieveCalls.push({
      excludedMessageIds: [...excludedMessageIds],
      recipient: email,
    });
    const excluded = new Set(excludedMessageIds);
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
    return message.link;
  }

  consumeLink(link: string): ConsumeResult {
    const message = [...this.messagesByRecipient.values()]
      .flat()
      .find((candidate) => candidate.link === link);
    if (!message) throw new Error("unknown synthetic magic link");

    if (message.consumed) {
      this.events.push({ id: message.id, type: "replay" });
      return {
        destination: "/en-US/auth/callback",
        text: callbackFailedTitle,
      };
    }

    message.consumed = true;
    this.consumedLinks.add(link);
    switch (message.kind) {
      case "initial-main": {
        this.createAuthUser("auth-original", message.recipient);
        this.currentAuthUserId = "auth-original";
        this.events.push({
          id: message.id,
          kind: message.kind,
          type: "consume",
          userId: "auth-original",
        });
        return { destination: "/en-US/account", text: completionTitle };
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
        this.linksByUserId.set(newUserId, retainedCustomerId);
        const profile = this.requireProfile(retainedCustomerId);
        profile.expireDate = null;
        this.events.push({
          id: message.id,
          kind: message.kind,
          type: "consume",
          userId: newUserId,
        });
        this.events.push({
          customerId: retainedCustomerId,
          type: "provider-reactivate",
          userId: newUserId,
        });
        this.reactivationObservations.push({
          customerId: retainedCustomerId,
          historyPresent: this.historyReady,
          userId: newUserId,
        });
        return {
          destination: "/en-US/account",
          text: "Current and upcoming",
        };
      }
      case "accepted-b":
        throw new Error("the generic accepted-b message must not be consumed");
    }
  }

  openAccount(): OpenAccountResult {
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

  private makeMessage(email: string, kind: FakeMessageKind): FakeMessage {
    this.messageSequence += 1;
    const id = `message-${this.messageSequence}`;
    const token = `synthetic-token-${this.messageSequence}`;
    const link = `${this.config.baseUrl}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(`/${this.config.locale}/auth/callback`)}`;
    const message = {
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

class FakeBrowser {
  private currentUrl = "";
  private pageText = "";
  private emailValue = "";
  private nativeValidationBlocked = false;
  private formReady = false;
  private selectedSection = "";

  constructor(readonly external: FakeAccountExternalState) {}

  open(url: string) {
    const parsed = new URL(url);
    this.external.recordBrowserAction({
      kind: "open",
      selectorOrDestination: parsed.pathname,
    });
    this.external.lastDestination =
      parsed.pathname.replace(/^\/en-US/, "") || "/";
    if (parsed.pathname === "/en-US/auth/sign-in") {
      this.currentUrl = url;
      this.pageText = "Sign in";
      this.formReady = true;
      this.emailValue = "";
      this.nativeValidationBlocked = false;
      return;
    }
    if (parsed.pathname === "/en-US/account") {
      const result = this.external.openAccount();
      this.currentUrl = `${this.external.config.baseUrl}${result.destination}`;
      this.pageText = result.text;
      this.formReady = result.destination.endsWith("/auth/sign-in");
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
      const result = this.external.consumeLink(url);
      this.currentUrl = `${this.external.config.baseUrl}${result.destination}`;
      this.pageText = result.text;
      this.formReady = false;
      return;
    }
    throw new Error("unknown synthetic browser destination");
  }

  fill(selector: string, value: string) {
    this.external.recordBrowserAction({
      kind: "fill",
      selectorOrDestination: selector,
    });
    if (selector !== signInEmailSelector) {
      throw new Error("the synthetic browser filled an unexpected control");
    }
    this.emailValue = value;
    this.nativeValidationBlocked = !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
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
      const message = this.external.sendMessage(this.emailValue, "sign-in");
      const response = `${acceptedTitle} ${acceptedBody}`;
      this.external.acceptedResponses.push(response);
      this.pageText =
        message.kind === "reauthentication" ? deletionReauthLinkSent : response;
      this.formReady = false;
      return;
    }
    if (selector.includes("Send another link")) {
      this.currentUrl = `${this.external.config.baseUrl}/en-US/auth/sign-in`;
      this.pageText = "Sign in";
      this.formReady = true;
      this.emailValue = "";
      this.nativeValidationBlocked = false;
      return;
    }
    if (selector === signOutSelector) {
      this.external.logout();
      this.currentUrl = `${this.external.config.baseUrl}/en-US`;
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
      this.pageText = deletionReauthLinkSent;
      return;
    }
    if (
      selector.includes("Danger zone") ||
      selector.includes('data-account-section="danger"')
    ) {
      this.selectedSection = "danger";
      return;
    }
    throw new Error("the synthetic browser clicked an unexpected control");
  }

  focus(selector: string) {
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
  }

  eval(input: string) {
    if (input.includes("validationMessage")) {
      return JSON.stringify({ blocked: this.nativeValidationBlocked });
    }
    if (input.includes("window.matchMedia")) return "true";
    throw new Error("the synthetic browser evaluated an unexpected script");
  }

  waitForFormAction(selector: string) {
    if (selector !== signInFormSelector || !this.formReady) {
      throw new Error("the sign-in form action is not ready");
    }
  }

  waitForText(matches: (text: string) => boolean) {
    if (!matches(this.pageText)) {
      throw new Error("the synthetic browser text assertion did not match");
    }
    return this.pageText;
  }

  waitForCondition(description: string, condition: string) {
    if (description === "account danger section") {
      if (this.selectedSection !== "danger") {
        throw new Error("the danger section is not selected");
      }
      return;
    }
    if (description === "deletion confirmation dialog") {
      if (!this.external.deletionDialog) {
        throw new Error("the deletion confirmation dialog is missing");
      }
      return;
    }
    if (description === "reauthentication dialog") {
      if (!this.external.reauthenticationDialog) {
        throw new Error("the reauthentication dialog is missing");
      }
      return;
    }
    if (condition.includes("account-reservations-current-title")) {
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
      return;
    }
    throw new Error(
      `the synthetic browser waited for an unknown condition: ${description}`
    );
  }

  waitForSnapshot(matches: (snapshot: string) => boolean) {
    const snapshot = this.external.historyReady
      ? "Current and upcoming\nPast reservations\nCancelled"
      : "";
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

const requireBrowser = () => {
  if (!activeBrowser) throw new Error("synthetic browser is not installed");
  return activeBrowser;
};

const browserResult = (stdout = ""): BrowserCommandResult => ({
  exitCode: 0,
  stderr: "",
  stdout,
});

/*
 * These are the only browser, delivery, auth-row, and provider-fixture
 * boundaries replaced in this regression. The case factory and its semantic
 * steps remain the implementation under test.
 */
mock.module("../browser", () => ({
  clickBrowserElement: (_run: Runner, _session: string, selector: string) =>
    Effect.sync(() => requireBrowser().click(selector)),
  evalBrowserScript: (
    _operation: string,
    _run: Runner,
    _session: string,
    input: string
  ) => Effect.sync(() => browserResult(requireBrowser().eval(input))),
  fillBrowserField: (
    _run: Runner,
    _session: string,
    selector: string,
    value: string
  ) => Effect.sync(() => requireBrowser().fill(selector, value)),
  focusBrowserElement: (_run: Runner, _session: string, selector: string) =>
    Effect.sync(() => requireBrowser().focus(selector)),
  normalizeBrowserText: (text: string) => text.replaceAll(/\s+/g, " ").trim(),
  openBrowserPage: (
    _config: WorkspaceE2EAccountConfig,
    _run: Runner,
    _session: string,
    url: string
  ) => Effect.sync(() => requireBrowser().open(url)),
  pressBrowserKey: (_run: Runner, _session: string, key: string) =>
    Effect.sync(() => requireBrowser().press(key)),
  readBrowserText: (_run: Runner, _session: string) =>
    Effect.sync(() => requireBrowser().text()),
  readBrowserUrl: (_run: Runner, _session: string) =>
    Effect.sync(() => requireBrowser().url()),
  waitForBrowserCondition: (
    _run: Runner,
    _session: string,
    description: string,
    condition: string
  ) =>
    Effect.sync(() =>
      requireBrowser().waitForCondition(description, condition)
    ),
  waitForBrowserReactFormAction: (
    _run: Runner,
    _session: string,
    selector: string
  ) => Effect.sync(() => requireBrowser().waitForFormAction(selector)),
  waitForBrowserText: ({
    matches,
  }: {
    readonly matches: (text: string) => boolean;
  }) => Effect.sync(() => requireBrowser().waitForText(matches)),
  waitForInteractiveSnapshot: ({
    matches,
  }: {
    readonly matches: (snapshot: string) => boolean;
  }) => Effect.sync(() => requireBrowser().waitForSnapshot(matches)),
}));

mock.module("./resend-retrieval", () => ({
  listSyntheticMessageIds: (
    _config: WorkspaceE2EAccountConfig,
    recipient: string
  ) => Effect.sync(() => requireExternal().listMessageIds(recipient)),
  retrieveWorkspaceE2EMagicLink: (
    _config: WorkspaceE2EAccountConfig,
    request: {
      readonly excludeMessageIds?: readonly string[];
      readonly recipient: string;
      readonly startedAt: Date;
    }
  ) =>
    Effect.sync(() =>
      requireExternal().retrieveMessage(
        request.recipient,
        request.excludeMessageIds ?? [],
        request.startedAt
      )
    ),
}));

mock.module("./auth-rows", () => ({
  assertNoAuthRows: (userId: string) =>
    Effect.sync(() => requireExternal().assertNoAuthRows(userId)),
  findAuthUserIdByEmail: (email: string) =>
    Effect.sync(() => requireExternal().findAuthUserId(email)),
  findLinkedDotyposCustomerId: (userId: string) =>
    Effect.sync(() => requireExternal().findLinkedCustomerId(userId)),
  removeSyntheticAccountLink: (accountId: string, customerId: string) =>
    Effect.sync(() =>
      requireExternal().removeAccountLink(accountId, customerId)
    ),
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
  cancelSyntheticReservation: () =>
    Effect.sync(() => {
      throw new Error(
        "the selected account cases must not create reservations"
      );
    }),
  createSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    profile: { readonly email: string; readonly firstName: string }
  ) => Effect.sync(() => requireExternal().createProfile(profile)),
  createSyntheticReservation: () =>
    Effect.sync(() => {
      throw new Error(
        "reservation fixture coverage belongs to its separate case"
      );
    }),
  expireSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    customerId: string
  ) => Effect.sync(() => requireExternal().expireProfile(customerId)),
  readSyntheticCustomerProfile: (
    _config: DatasourceConfig,
    customerId: string
  ) => Effect.sync(() => requireExternal().readProfile(customerId)),
}));

const makeConfig = (): WorkspaceE2EAccountConfig => ({
  baseUrl,
  bypassSecret: undefined,
  expectedHost,
  locale: "en-US",
  resendApiKey: "synthetic-resend-retrieval-key",
  runId: syntheticRunId as WorkspaceE2EAccountConfig["runId"],
  timeouts: workspaceE2ETimeouts,
});

const makeScenario = () => {
  const config = makeConfig();
  const mainRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    workspaceE2EAccountMainRecipientLabel
  );
  const acceptedBRecipient = makeWorkspaceE2EAccountRecipient(
    config,
    "accepted-b"
  );
  const external = new FakeAccountExternalState(
    config,
    mainRecipient,
    acceptedBRecipient
  );
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
  const run: Runner = async () => {
    throw new Error("the account case bypassed the mocked browser boundary");
  };
  const datasourceConfig = {} as DatasourceConfig;

  return {
    browser,
    config,
    datasourceConfig,
    external,
    journalRef,
    lifecycleHandoff,
    operations,
    rateBudget,
    retries,
    run,
  };
};

const executeCase = async (
  testCase: WorkspaceE2EAccountCase,
  scenario: ReturnType<typeof makeScenario>,
  stepIds: string[]
) => {
  const runStep: WorkspaceE2EStepRunner = <A, R>(
    step: WorkspaceE2EStep<A, R>
  ) => {
    stepIds.push(step.id);
    // Deliberately return the implementation's Effect unchanged. The fake
    // boundary models its dependencies; it does not replace semantic steps.
    return step.execute;
  };
  const effect = testCase.execute({
    journalRef: scenario.journalRef,
    runStep,
    session,
  });
  await Effect.runPromise(effect as Effect.Effect<void, WorkspaceE2EError>);
};

const buildCase = async (
  makeCases: typeof import("./cases").makeWorkspaceE2EAccountCases,
  caseId: WorkspaceE2EAccountCaseId,
  scenario: ReturnType<typeof makeScenario>
) => {
  const cases = makeCases({
    config: scenario.config,
    datasourceConfig: scenario.datasourceConfig,
    lifecycleHandoff: scenario.lifecycleHandoff,
    rateBudget: scenario.rateBudget,
    run: scenario.run,
    session,
  });
  const selected = cases.find(({ id }) => id === caseId);
  if (!selected) throw new Error(`case ${caseId} was not built`);
  return selected;
};

afterEach(() => {
  activeExternal = undefined;
  activeBrowser = undefined;
  setSystemTime();
});

test("executes the selected account lifecycle cases with a fresh factory per case", async () => {
  setSystemTime(fixedNow);
  const { makeWorkspaceE2EAccountCases } = await import("./cases");
  const scenario = makeScenario();
  const executedCaseIds: WorkspaceE2EAccountCaseId[] = [];
  const stepIds: string[] = [];
  const builtCases: WorkspaceE2EAccountCase[] = [];

  expect(
    workspaceE2EAccountCaseIds.filter((caseId) =>
      selectedCaseIds.includes(caseId as (typeof selectedCaseIds)[number])
    )
  ).toEqual(selectedCaseIds);

  for (const caseId of selectedCaseIds) {
    const selected = await buildCase(
      makeWorkspaceE2EAccountCases,
      caseId,
      scenario
    );
    executedCaseIds.push(caseId);
    builtCases.push(selected);
    const previous = builtCases.at(-2);
    if (previous) expect(selected).not.toBe(previous);
    await executeCase(selected, scenario, stepIds);

    if (caseId === "account-magic-link-delivery") {
      // Profile completion and reservation transitions intentionally retain
      // their separate coverage; seed their successful postcondition here.
      scenario.external.seedCompletedProfileAndHistory();
    }
  }

  expect(executedCaseIds).toEqual(selectedCaseIds);
  expect(scenario.external.profileHistorySeeded).toBe(true);
  expect(stepIds.length).toBeGreaterThan(0);
  expect(scenario.lifecycleHandoff.firstAcceptedRequestedAt).toEqual(fixedNow);

  expect(scenario.operations).toEqual([
    "send",
    "send",
    "verify",
    "send",
    "verify",
    "verify",
    "send",
    "verify",
  ]);
  expect(
    scenario.operations.filter((operation) => operation === "send")
  ).toHaveLength(4);
  expect(
    scenario.operations.filter((operation) => operation === "verify")
  ).toHaveLength(4);
  expect(scenario.retries).toEqual([]);

  expect(magicLinkOperationsPerWindow).toBe(4);
  expect(magicLinkOperationWindowMs).toBe(600_000);
  expect(magicLinkOperationsPerWindow).toBe(
    betterAuthMagicLinkOptions.rateLimit.max - 1
  );
  expect(magicLinkOperationWindowMs).toBe(
    betterAuthMagicLinkOptions.rateLimit.window * 1000
  );

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
    "replay:",
    "send:reactivation",
    "receive:reactivation",
    "consume:reactivation",
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
  expect(scenario.external.acceptedResponses.slice(0, 2)).toEqual([
    `${acceptedTitle} ${acceptedBody}`,
    `${acceptedTitle} ${acceptedBody}`,
  ]);
  expect(scenario.external.retrieveCalls).toEqual([
    {
      excludedMessageIds: [],
      recipient: scenario.external.mainRecipient,
    },
    {
      excludedMessageIds: [mainMessages[0]?.id ?? ""],
      recipient: scenario.external.mainRecipient,
    },
    {
      excludedMessageIds: [
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
  expect(new Set(scenario.external.createdAuthIds).size).toBe(2);

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
  expect(
    scenario.external.events
      .filter(({ type }) => type === "relink")
      .map(({ mode }) => mode)
  ).toEqual(["active", "expired"]);
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
    "auth-original",
    "auth-reactivated",
  ]);
  expect(scenario.external.journal.dotyposCustomerIds).toEqual([
    "customer-retained",
    "customer-duplicate-1",
  ]);
  expect(scenario.external.journal.dotyposReservationIds).toEqual([]);

  expect(
    scenario.external.browserActions.filter(
      ({ kind, selectorOrDestination }) =>
        kind === "fill" && selectorOrDestination === signInEmailSelector
    )
  ).toHaveLength(4);
  expect(
    scenario.external.browserActions.filter(
      ({ kind, selectorOrDestination }) =>
        kind === "click" && selectorOrDestination === signInSubmitSelector
    )
  ).toHaveLength(4);
  expect(
    scenario.external.browserActions.filter(
      ({ kind, selectorOrDestination }) =>
        kind === "click" && selectorOrDestination === deleteReauthSendSelector
    )
  ).toHaveLength(1);

  expect(
    scenario.external.events
      .filter(({ type }) =>
        ["send", "receive", "logout", "consume", "deletion", "replay"].includes(
          type
        )
      )
      .slice(-1)
  ).toEqual([
    {
      id: mainMessages[2]?.id,
      kind: "reactivation",
      type: "consume",
      userId: "auth-reactivated",
    },
  ]);
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

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toEqual(["requires the first accepted main request handoff"]);
  expect(scenario.external.browserActions).toEqual([]);
  expect(scenario.external.events).toEqual([]);
  expect(scenario.external.authReads).toEqual([]);
  expect(scenario.external.providerCalls).toEqual([]);
  expect(scenario.external.listCalls).toEqual([]);
  expect(scenario.external.retrieveCalls).toEqual([]);
  expect(scenario.operations).toEqual([]);
  expect(scenario.retries).toEqual([]);
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

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toEqual([
    "requires the reauthentication handoff from the marker case",
  ]);
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

  expect(Exit.isFailure(exit)).toBe(true);
  expect(stepIds).toContain("signs the same account back in");
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
