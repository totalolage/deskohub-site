import { expect, test } from "bun:test";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { createServer } from "node:http";
import { normalizePhoneNumber } from "@deskohub/dotypos";
import { chromium, type Page } from "@playwright/test";
import {
  isWorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  type WorkspaceE2EProfileNavigationDiagnosticCode,
} from "../errors";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import {
  accountSectionLabels,
  accountSectionLandmarks,
} from "./account-sections";
import {
  triggerProfileHistoryBack,
  verifyProfileNavigation,
} from "./profile-navigation";

type MockPage = {
  readonly evaluateInputs: readonly unknown[];
  readonly navigationWaitCalls: () => number;
  readonly page: Page;
  readonly goBackCalls: () => number;
};

const makeMockPage = (): MockPage => {
  const evaluateInputs: unknown[] = [];
  let goBackCallCount = 0;
  let navigationWaitCallCount = 0;
  const page = Object.assign({} as Page, {
    evaluate: async (expression: unknown) => {
      evaluateInputs.push(expression);
    },
    goBack: async () => {
      goBackCallCount += 1;
      throw new Error("page.goBack must not be used for guarded history");
    },
    waitForNavigation: async () => {
      navigationWaitCallCount += 1;
      throw new Error("navigation waits must not be used for guarded history");
    },
  });

  return {
    evaluateInputs,
    goBackCalls: () => goBackCallCount,
    navigationWaitCalls: () => navigationWaitCallCount,
    page,
  };
};

type ProfileNavigationSection =
  | "reservations"
  | "profile"
  | "billing"
  | "legal"
  | "danger";

type ProfileNavigationState = {
  billing: {
    companyName: string;
    kind: string;
  };
  dirty: boolean;
  profile: {
    firstName: string;
    lastName: string;
    phone: string;
  };
  section: ProfileNavigationSection;
  url: string;
};

type ProfileNavigationFakePage = {
  readonly actions: readonly string[];
  readonly page: Page;
  readonly serverPhone: string;
  readonly state: ProfileNavigationState;
};

type PersistedRestoreFailureStage =
  | "document-reload"
  | "profile-handler-wait"
  | "profile-native-click"
  | "profile-selected-landmark"
  | "profile-form-visibility"
  | "first-name-restore"
  | "last-name-restore"
  | "phone-restore"
  | "billing-navigation"
  | "billing-kind-restore"
  | "billing-company-restore"
  | "return-profile-navigation"
  | "unavailable-heading-expectation";

type ProfileNavigationFailurePhase =
  | "saved-profile-baseline"
  | "draft-retention"
  | PersistedRestoreFailureStage;

const privateFailureDetails = "private profile navigation fixture details";

const makeProfileNavigationFakePage = (
  baseUrl: string,
  failurePhase?: ProfileNavigationFailurePhase
): ProfileNavigationFakePage => {
  const homeUrl = `${baseUrl}/en-US`;
  const accountUrl = `${baseUrl}/en-US/account`;
  const originalProfile = {
    firstName: "Ada",
    lastName: "Example",
    phone: "+420 555 000 111",
  };
  const normalizedPhone = normalizePhoneNumber(originalProfile.phone);
  if (normalizedPhone === null)
    throw new Error("fake profile phone is not a valid canonical phone number");
  const serverSnapshot = {
    ...originalProfile,
    phone: normalizedPhone,
  };
  const originalBilling = {
    companyName: "Original Company",
    kind: "business",
  };
  const state: ProfileNavigationState = {
    billing: { ...originalBilling },
    dirty: false,
    profile: { ...originalProfile },
    section: "reservations",
    url: accountUrl,
  };
  const actions: string[] = [];
  let dialogResolver:
    | ((dialog: {
        readonly accept: () => Promise<void>;
        readonly dismiss: () => Promise<void>;
        readonly type: () => string;
      }) => void)
    | undefined;
  let documentReloaded = false;
  let restoredProfileNavigationCount = 0;
  let restoredBillingNavigationCount = 0;

  const isProfileFormVisible = () =>
    (state.section === "profile" || state.section === "billing") &&
    !(
      documentReloaded &&
      failurePhase === "profile-form-visibility" &&
      state.section === "profile"
    );
  const isVisible = (name: string) => {
    if (name === "#account-profile-form") return isProfileFormVisible();
    if (name === accountSectionLandmarks.profile)
      return state.section === "profile";
    if (name === accountSectionLandmarks.billing)
      return state.section === "billing";
    if (name === "#account-profile-submit") return isProfileFormVisible();
    if (name === "#account-profile-billing-company-name")
      return state.section === "billing" && state.billing.kind === "business";
    return true;
  };
  const valueFor = (name: string) => {
    switch (name) {
      case "#account-profile-first-name":
        return state.profile.firstName;
      case "#account-profile-last-name":
        return state.profile.lastName;
      case "#account-profile-phone":
        return state.profile.phone;
      case "#account-profile-billing-company-name":
        return state.billing.companyName;
      case "#account-profile-billing-kind":
        return state.billing.kind;
      default:
        return "";
    }
  };
  const countFor = (name: string) =>
    name.startsWith("heading:Customer accounts are temporarily unavailable")
      ? 0
      : 1;
  const expectedText = (value: unknown): string | undefined => {
    if (!Array.isArray(value)) return undefined;
    const first = value[0];
    if (typeof first === "string") return first;
    if (first && typeof first === "object" && "string" in first) {
      const stringValue = first.string;
      return typeof stringValue === "string" ? stringValue : undefined;
    }
    return undefined;
  };

  const requestDialog = (kind: "history-back" | "home") => {
    let resolveAction!: () => void;
    const action = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });
    const dialog = {
      accept: async () => {
        actions.push(`dialog:${kind}:accept`);
        if (kind === "home") {
          state.url = homeUrl;
          state.section = "reservations";
          state.dirty = false;
          actions.push("navigate:home");
        }
        resolveAction();
      },
      dismiss: async () => {
        actions.push(`dialog:${kind}:dismiss`);
        resolveAction();
      },
      type: () => "confirm",
    };
    actions.push(`dialog:${kind}:open`);
    dialogResolver?.(dialog);
    dialogResolver = undefined;
    return action;
  };

  const makeLocator = (name: string) => {
    const locator = {
      _apiName: "Locator",
      elementHandle: async () => ({
        dispose: async () => {},
        sectionButton: name,
      }),
      _expect: async (
        expression: string,
        parameters: Record<string, unknown>
      ) => {
        if (
          failurePhase === "draft-retention" &&
          expression === "to.have.value" &&
          name === "#account-profile-first-name" &&
          state.profile.firstName === "Ada draft"
        ) {
          throw new Error(privateFailureDetails);
        }
        if (
          documentReloaded &&
          expression === "to.have.value" &&
          ((failurePhase === "first-name-restore" &&
            name === "#account-profile-first-name") ||
            (failurePhase === "last-name-restore" &&
              name === "#account-profile-last-name") ||
            (failurePhase === "phone-restore" &&
              name === "#account-profile-phone") ||
            (failurePhase === "billing-kind-restore" &&
              name === "#account-profile-billing-kind") ||
            (failurePhase === "billing-company-restore" &&
              name === "#account-profile-billing-company-name"))
        ) {
          throw new Error(privateFailureDetails);
        }
        if (
          documentReloaded &&
          failurePhase === "unavailable-heading-expectation" &&
          expression === "to.have.count" &&
          name === "heading:Customer accounts are temporarily unavailable"
        ) {
          throw new Error(privateFailureDetails);
        }
        let actual: boolean | number | string;
        let matches: boolean;
        if (expression === "to.be.visible") {
          actual = isVisible(name);
          matches = actual;
          actions.push(`assert-visible:${name}`);
        } else if (expression === "to.have.count") {
          actual = countFor(name);
          matches = actual === parameters.expectedNumber;
        } else if (expression === "to.have.value") {
          actual = valueFor(name);
          matches = actual === expectedText(parameters.expectedText);
          actions.push(`assert-value:${name}:${actual}`);
        } else {
          actual = true;
          matches = true;
        }
        return {
          matches,
          received: { value: actual },
        };
      },
      click: async () => {
        actions.push(`click:${name}`);
        if (name.startsWith("section:")) {
          if (documentReloaded && name === "section:profile") {
            restoredProfileNavigationCount += 1;
            if (
              (failurePhase === "profile-native-click" &&
                restoredProfileNavigationCount === 1) ||
              (failurePhase === "return-profile-navigation" &&
                restoredProfileNavigationCount === 2)
            ) {
              throw new Error(privateFailureDetails);
            }
          }
          if (documentReloaded && name === "section:billing") {
            restoredBillingNavigationCount += 1;
            if (
              failurePhase === "billing-navigation" &&
              restoredBillingNavigationCount === 1
            ) {
              throw new Error(privateFailureDetails);
            }
          }
          if (
            documentReloaded &&
            name === "section:profile" &&
            failurePhase === "profile-selected-landmark" &&
            restoredProfileNavigationCount === 1
          ) {
            return;
          }
          state.section = name.slice(
            "section:".length
          ) as ProfileNavigationSection;
          return;
        }
        if (name === "home-link") {
          if (state.dirty) return requestDialog("home");
          state.url = homeUrl;
          state.section = "reservations";
          actions.push("navigate:home");
          return;
        }
        if (name === "account-link") {
          state.url = accountUrl;
          state.section = "reservations";
          actions.push("navigate:account");
          return;
        }
        if (name === "#account-profile-submit") {
          actions.push("native-submit");
          if (
            state.billing.kind === "business" &&
            state.billing.companyName === ""
          ) {
            state.section = "billing";
            actions.push("native-invalid:billing");
          }
        }
      },
      evaluate: async () => {
        actions.push(`evaluate:${name}`);
        return "Please fill out this field.";
      },
      fill: async (value: string) => {
        if (
          name === "#account-profile-billing-company-name" &&
          state.section !== "billing"
        ) {
          throw new Error("billing company fill attempted while hidden");
        }
        actions.push(`fill:${name}:${value}`);
        switch (name) {
          case "#account-profile-first-name":
            state.profile.firstName = value;
            break;
          case "#account-profile-billing-company-name":
            state.billing.companyName = value;
            break;
        }
        state.dirty = true;
      },
      getByRole: (role: string, options: { readonly name?: string }) => {
        if (role !== "link")
          throw new Error(`unsupported banner role: ${role}`);
        if (options.name === "Deskohub Workspace")
          return makeLocator("home-link");
        if (options.name === "Account") return makeLocator("account-link");
        throw new Error(`unsupported banner link: ${options.name}`);
      },
      inputValue: async () => {
        if (
          failurePhase === "saved-profile-baseline" &&
          name === "#account-profile-first-name"
        ) {
          throw new Error(privateFailureDetails);
        }
        return valueFor(name);
      },
      isVisible: async () => isVisible(name),
      toString: () => `Locator(${name})`,
      waitFor: async (options?: { readonly state?: string }) => {
        if (options?.state === "visible" && !isVisible(name)) {
          throw new Error(`locator is not visible: ${name}`);
        }
      },
    };
    return locator;
  };

  const getByRole = (
    role: string,
    options: { readonly name?: string } = {}
  ) => {
    if (role === "banner") return makeLocator("banner");
    if (role === "button") {
      const section = Object.entries(accountSectionLabels).find(
        ([, label]) => options.name === label
      )?.[0];
      if (section) return makeLocator(`section:${section}`);
    }
    if (role === "heading") return makeLocator(`heading:${options.name ?? ""}`);
    throw new Error(`unsupported role: ${role}`);
  };

  const page = Object.assign({} as Page, {
    _apiName: "Page",
    context: () => ({ _options: { baseURL: baseUrl } }),
    evaluate: async (expression: unknown) => {
      const source = String(expression);
      if (source.includes("window.history.back()")) {
        actions.push("evaluate:window.history.back()");
        return requestDialog("history-back");
      }
      throw new Error("unsupported page evaluation");
    },
    getByRole,
    goto: async (url: string) => {
      if (url !== accountUrl)
        throw new Error(`unsupported document URL: ${url}`);
      if (failurePhase === "document-reload") {
        throw new Error(privateFailureDetails);
      }
      state.url = url;
      state.section = "reservations";
      state.dirty = false;
      state.profile = { ...serverSnapshot };
      state.billing = { ...originalBilling };
      documentReloaded = true;
      actions.push("document-remount:account");
    },
    locator: (selector: string) => makeLocator(selector),
    mainFrame: () => ({
      _expect: async (
        expression: string,
        parameters: Record<string, unknown>
      ) => {
        if (expression !== "to.have.url")
          throw new Error(`unsupported page expectation: ${expression}`);
        const expected = expectedText(parameters.expectedText);
        return {
          matches: state.url === expected,
          received: { value: state.url },
        };
      },
    }),
    toHaveURL: undefined,
    viewportSize: () => ({ height: 1000, width: 1440 }),
    waitForEvent: async () =>
      new Promise((resolve) => {
        dialogResolver = resolve;
      }),
    waitForFunction: async (_predicate: unknown, argument: unknown) => {
      if (
        typeof argument === "object" &&
        argument !== null &&
        "sectionButton" in argument
      ) {
        if (
          documentReloaded &&
          failurePhase === "profile-handler-wait" &&
          (argument as { readonly sectionButton: string }).sectionButton ===
            "section:profile"
        ) {
          throw new Error(privateFailureDetails);
        }
        actions.push(
          `handler-ready:${String(
            (argument as { readonly sectionButton: unknown }).sectionButton
          )}`
        );
        return;
      }
      if (
        typeof argument === "object" &&
        argument !== null &&
        "section" in argument
      ) {
        const section = (argument as { readonly section: string }).section;
        actions.push(`section-ready:${section}`);
        if (state.section !== section) {
          throw new Error(`section did not become ready: ${section}`);
        }
      }
    },
    waitForURL: async (url: string) => {
      actions.push(`wait-url:${url}`);
    },
  });

  return { actions, page, serverPhone: serverSnapshot.phone, state };
};

const chromiumAvailable = await access(
  chromium.executablePath(),
  constants.X_OK
)
  .then(() => true)
  .catch(() => false);

const startNavigationTestServer = async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html" });
    response.end(`
      <!doctype html>
      <title>ready</title>
      <script>
        if (window.navigation) {
          window.navigation.addEventListener("navigate", (event) => {
            if (event.navigationType !== "traverse") return;
            document.title = "cancelled-back";
            event.preventDefault();
          });
        }
      </script>
    `);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    throw new Error("navigation regression server did not receive a port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
};

test("uses one evaluated history trigger instead of Playwright navigation waits", async () => {
  const mockPage = makeMockPage();

  await triggerProfileHistoryBack(mockPage.page);

  expect(mockPage.goBackCalls()).toBe(0);
  expect(mockPage.navigationWaitCalls()).toBe(0);
  expect(mockPage.evaluateInputs).toHaveLength(1);
  expect(mockPage.evaluateInputs[0]).toBeInstanceOf(Function);
  expect(String(mockPage.evaluateInputs[0])).toContain("window.history.back()");
});

test("keeps cached drafts through soft navigation and resets them on document remount", async () => {
  const fake = makeProfileNavigationFakePage(
    "https://account-navigation.example.test"
  );

  await verifyProfileNavigation(
    fake.page,
    "https://account-navigation.example.test"
  );

  const clearIndex = fake.actions.indexOf(
    "fill:#account-profile-billing-company-name:"
  );
  expect(clearIndex).toBeGreaterThan(-1);
  const billingSelectionIndex = fake.actions.lastIndexOf(
    "click:section:billing",
    clearIndex
  );
  const billingVisibleIndex = fake.actions.lastIndexOf(
    "assert-visible:#account-profile-billing-kind",
    clearIndex
  );
  expect(billingSelectionIndex).toBeGreaterThan(-1);
  expect(billingVisibleIndex).toBeGreaterThan(billingSelectionIndex);
  expect(billingVisibleIndex).toBeLessThan(clearIndex);

  const profileAfterClearIndex = fake.actions.findIndex(
    (action, index) => index > clearIndex && action === "click:section:profile"
  );
  const invalidBillingIndex = fake.actions.indexOf("native-invalid:billing");
  const softAccountNavigationIndex = fake.actions.indexOf("navigate:account");
  const draftAfterSoftNavigationIndex = fake.actions.findIndex(
    (action, index) =>
      index > softAccountNavigationIndex &&
      action === "assert-value:#account-profile-first-name:Ada draft"
  );
  const leaveAcceptIndex = fake.actions.lastIndexOf("dialog:home:accept");
  const leaveNavigationIndex = fake.actions.findIndex(
    (action, index) => index > leaveAcceptIndex && action === "navigate:home"
  );
  const documentRemountIndex = fake.actions.indexOf("document-remount:account");
  const originalAfterRemountIndex = fake.actions.findIndex(
    (action, index) =>
      index > documentRemountIndex &&
      action === "assert-value:#account-profile-first-name:Ada"
  );
  expect(profileAfterClearIndex).toBeGreaterThan(clearIndex);
  expect(invalidBillingIndex).toBeGreaterThan(profileAfterClearIndex);
  expect(softAccountNavigationIndex).toBeGreaterThan(-1);
  expect(draftAfterSoftNavigationIndex).toBeGreaterThan(
    softAccountNavigationIndex
  );
  expect(draftAfterSoftNavigationIndex).toBeLessThan(documentRemountIndex);
  expect(leaveAcceptIndex).toBeGreaterThan(-1);
  expect(leaveNavigationIndex).toBeGreaterThan(leaveAcceptIndex);
  expect(documentRemountIndex).toBeGreaterThan(leaveNavigationIndex);
  expect(originalAfterRemountIndex).toBeGreaterThan(documentRemountIndex);
  expect(
    fake.actions.filter((action) => action === "navigate:account")
  ).toEqual(["navigate:account"]);
  expect(fake.actions.filter((action) => action.startsWith("dialog:"))).toEqual(
    [
      "dialog:home:open",
      "dialog:home:dismiss",
      "dialog:history-back:open",
      "dialog:history-back:dismiss",
      "dialog:home:open",
      "dialog:home:accept",
    ]
  );
  expect(fake.state.url).toBe(
    "https://account-navigation.example.test/en-US/account"
  );
  expect(fake.state.section).toBe("profile");
  expect(fake.state.profile.firstName).toBe("Ada");
  expect(fake.state.profile.phone).toBe(fake.serverPhone);
  expect(fake.state.billing.companyName).toBe("Original Company");
});

test("redacts a saved-profile baseline failure with its closed diagnostic", async () => {
  const fake = makeProfileNavigationFakePage(
    "https://account-navigation.example.test",
    "saved-profile-baseline"
  );
  const failure = await verifyProfileNavigation(
    fake.page,
    "https://account-navigation.example.test"
  ).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expectProfileNavigationFailure(failure, "account_profile_baseline_failed");
});

test("redacts a draft-retention failure with its later-phase diagnostic", async () => {
  const fake = makeProfileNavigationFakePage(
    "https://account-navigation.example.test",
    "draft-retention"
  );
  const failure = await verifyProfileNavigation(
    fake.page,
    "https://account-navigation.example.test"
  ).then(
    () => undefined,
    (cause: unknown) => cause
  );

  expectProfileNavigationFailure(
    failure,
    "account_profile_draft_retention_failed"
  );
});

const persistedRestoreFailureStages = [
  {
    phase: "document-reload",
    diagnosticCode: "account_profile_persisted_document_reload_failed",
  },
  {
    phase: "profile-handler-wait",
    diagnosticCode: "account_profile_persisted_profile_handler_wait_failed",
  },
  {
    phase: "profile-native-click",
    diagnosticCode: "account_profile_persisted_profile_click_failed",
  },
  {
    phase: "profile-selected-landmark",
    diagnosticCode: "account_profile_persisted_profile_landmark_wait_failed",
  },
  {
    phase: "profile-form-visibility",
    diagnosticCode: "account_profile_persisted_profile_form_visibility_failed",
  },
  {
    phase: "first-name-restore",
    diagnosticCode: "account_profile_persisted_first_name_restore_failed",
  },
  {
    phase: "last-name-restore",
    diagnosticCode: "account_profile_persisted_last_name_restore_failed",
  },
  {
    phase: "phone-restore",
    diagnosticCode: "account_profile_persisted_phone_restore_failed",
  },
  {
    phase: "billing-navigation",
    diagnosticCode: "account_profile_persisted_billing_navigation_failed",
  },
  {
    phase: "billing-kind-restore",
    diagnosticCode: "account_profile_persisted_billing_kind_restore_failed",
  },
  {
    phase: "billing-company-restore",
    diagnosticCode: "account_profile_persisted_billing_company_restore_failed",
  },
  {
    phase: "return-profile-navigation",
    diagnosticCode:
      "account_profile_persisted_return_profile_navigation_failed",
  },
  {
    phase: "unavailable-heading-expectation",
    diagnosticCode:
      "account_profile_persisted_unavailable_heading_expectation_failed",
  },
] as const satisfies readonly {
  readonly phase: PersistedRestoreFailureStage;
  readonly diagnosticCode: WorkspaceE2EProfileNavigationDiagnosticCode;
}[];

test("reports a closed stage-specific diagnostic for persisted profile restore failures", async () => {
  for (const { phase, diagnosticCode } of persistedRestoreFailureStages) {
    const fake = makeProfileNavigationFakePage(
      "https://account-navigation.example.test",
      phase
    );
    const failure = await verifyProfileNavigation(
      fake.page,
      "https://account-navigation.example.test"
    ).then(
      () => undefined,
      (cause: unknown) => cause
    );

    expectProfileNavigationFailure(failure, diagnosticCode);
  }
});

const expectProfileNavigationFailure = (
  failure: unknown,
  diagnosticCode: WorkspaceE2EProfileNavigationDiagnosticCode
) => {
  expect(failure).toBeInstanceOf(WorkspaceE2EError);
  if (!(failure instanceof WorkspaceE2EError)) return;

  expect(failure.diagnosticCode).toBe(diagnosticCode);
  expect(isWorkspaceE2EDiagnosticCode(failure.diagnosticCode)).toBe(true);
  expect(failure).toMatchObject({
    diagnosticCode,
    message: "Profile navigation verification failed",
    operation: "verify profile navigation and unsaved changes",
  });
  expect(failure.cause).toBeUndefined();
  expect(failure.causes).toBeUndefined();
  expect(failure.message).not.toContain(privateFailureDetails);
  expect(JSON.stringify(failure)).not.toContain(privateFailureDetails);
  const annotation = formatWorkspaceE2EFailureAnnotation({
    caseId: "account-profile-completion",
    diagnosticCode: failure.diagnosticCode,
    failureKind: "error",
    outcome: "failed",
    stepId: "verifyPages",
  });
  expect(annotation).toContain(`diagnostic_code=${diagnosticCode}`);
  expect(annotation).not.toContain(privateFailureDetails);
};

test.skipIf(!chromiumAvailable)(
  "resolves the evaluated trigger when the Navigation API cancels same-document back",
  async () => {
    const server = await startNavigationTestServer();
    try {
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.goto(`${server.baseUrl}/first`);
        await page.evaluate(() => {
          window.history.pushState({}, "", "/second");
        });

        expect(await page.evaluate(() => "navigation" in window)).toBe(true);

        const triggerOutcome = await Promise.race([
          triggerProfileHistoryBack(page).then(() => "resolved" as const),
          new Promise<"timed-out">((resolve) =>
            setTimeout(() => resolve("timed-out"), 1000)
          ),
        ]);

        expect(triggerOutcome).toBe("resolved");
        await page.waitForFunction(() => document.title === "cancelled-back", {
          timeout: 1000,
        });
        expect(page.url()).toBe(`${server.baseUrl}/second`);
      } finally {
        await browser.close();
      }
    } finally {
      await server.close();
    }
  }
);
