import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { normalizePhoneNumber } from "@deskohub/dotypos";
import { chromium, errors, type Page } from "@playwright/test";
import {
  accountSectionLabel,
  accountSections,
} from "../../features/account/sections";
import { playwrightChromiumAvailable } from "../../shared/testing/playwright-browser";
import {
  isWorkspaceE2EDiagnosticCode,
  WorkspaceE2EError,
  type WorkspaceE2EProfileNavigationDiagnosticCode,
} from "../errors";
import { formatWorkspaceE2EFailureAnnotation } from "../github-actions";
import { accountSectionLandmarks } from "./account-sections";
import {
  triggerProfileHistoryBack,
  verifyProfileNavigation,
} from "./profile-navigation";

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
  readonly page: Page;
};

type ProfileNavigationFailurePhase =
  | "saved-profile-baseline"
  | "profile-handler-wait";

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
  let dialogResolver:
    | ((dialog: {
        readonly accept: () => Promise<void>;
        readonly dismiss: () => Promise<void>;
        readonly type: () => string;
      }) => void)
    | undefined;
  let documentReloaded = false;

  const isProfileFormVisible = () =>
    state.section === "profile" || state.section === "billing";
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

  // Like the account layout, a section switch records its section in the
  // account pathname.
  const switchSection = (section: ProfileNavigationSection) => {
    state.section = section;
    state.url = `${accountUrl}/${section}`;
  };

  const requestDialog = (kind: "history-back" | "home") => {
    let resolveAction!: () => void;
    const action = new Promise<void>((resolve) => {
      resolveAction = resolve;
    });
    const dialog = {
      accept: async () => {
        if (kind === "home") {
          state.url = homeUrl;
          state.section = "reservations";
          state.dirty = false;
        }
        resolveAction();
      },
      dismiss: async () => {
        resolveAction();
      },
      type: () => "confirm",
    };
    dialogResolver?.(dialog);
    dialogResolver = undefined;
    return action;
  };

  const makeLocator = (name: string) => {
    const locator = {
      _apiName: "Locator",
      elementHandle: async () => ({
        dispose: async () => {},
        sectionLink: name,
      }),
      _expect: async (
        expression: string,
        parameters: Record<string, unknown>
      ) => {
        let actual: boolean | number | string;
        let matches: boolean;
        if (expression === "to.be.visible") {
          actual = isVisible(name);
          matches = actual;
        } else if (expression === "to.have.count") {
          actual = countFor(name);
          matches = actual === parameters.expectedNumber;
        } else if (expression === "to.have.value") {
          actual = valueFor(name);
          matches = actual === expectedText(parameters.expectedText);
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
        if (name.startsWith("section:")) {
          switchSection(
            name.slice("section:".length) as ProfileNavigationSection
          );
          return;
        }
        if (name === "home-link") {
          if (state.dirty) return requestDialog("home");
          state.url = homeUrl;
          state.section = "reservations";
          return;
        }
        if (name === "account-link") {
          state.url = accountUrl;
          state.section = "reservations";
          return;
        }
        if (name === "#account-profile-submit") {
          if (
            state.billing.kind === "business" &&
            state.billing.companyName === ""
          ) {
            switchSection("billing");
          }
        }
      },
      evaluate: async () => {
        return "Please fill out this field.";
      },
      fill: async (value: string) => {
        if (
          name === "#account-profile-billing-company-name" &&
          state.section !== "billing"
        ) {
          throw new Error("billing company fill attempted while hidden");
        }
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
    if (role === "link") {
      const section = accountSections.find(
        (candidate) => options.name === accountSectionLabel(candidate, "en-US")
      );
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
        return requestDialog("history-back");
      }
      throw new Error("unsupported page evaluation");
    },
    getByRole,
    goto: async (url: string) => {
      if (url !== accountUrl)
        throw new Error(`unsupported document URL: ${url}`);
      state.url = url;
      state.section = "reservations";
      state.dirty = false;
      state.profile = { ...serverSnapshot };
      state.billing = { ...originalBilling };
      documentReloaded = true;
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
        "sectionLink" in argument
      ) {
        if (
          documentReloaded &&
          failurePhase === "profile-handler-wait" &&
          (argument as { readonly sectionLink: string }).sectionLink ===
            "section:profile"
        ) {
          throw new errors.TimeoutError(privateFailureDetails);
        }
        return { dispose: async () => {}, jsonValue: async () => "ready" };
      }
      if (
        typeof argument === "object" &&
        argument !== null &&
        "section" in argument
      ) {
        const section = (argument as { readonly section: string }).section;
        if (state.section !== section) {
          throw new Error(`section did not become ready: ${section}`);
        }
      }
      return { dispose: async () => {}, jsonValue: async () => true };
    },
    waitForURL: async () => {},
  });

  return { page };
};

const chromiumAvailable = await playwrightChromiumAvailable();

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

test("names the section selection stage and failure kind without the private cause", async () => {
  const fake = makeProfileNavigationFakePage(
    "https://account-navigation.example.test",
    "profile-handler-wait"
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
    "account_profile_persisted_profile_handler_wait_failed"
  );
  expect(failure).toMatchObject({
    message:
      "Profile navigation verification failed at section selection stage link-handler-wait (timeout)",
  });
});

const closedProfileNavigationFailureMessage =
  /^Profile navigation verification failed (at section selection stage (link-handler-wait|panel-hydration-wait|native-link-click|selected-landmark-wait) )?\((timeout|strict-mode-violation|error)\)$/;

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
    operation: "verify profile navigation and unsaved changes",
  });
  expect(failure.message).toMatch(closedProfileNavigationFailureMessage);
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
