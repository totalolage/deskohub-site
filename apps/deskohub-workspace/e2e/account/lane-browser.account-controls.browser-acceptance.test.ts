import { afterAll, beforeAll, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { type Browser, chromium } from "@playwright/test";
import { Effect } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EError } from "../errors";
import type { Runner } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";
import { makeWorkspaceE2EAccountLaneBrowser } from "./lane-browser";

const laneEmail = testEmailAddress("lane-controls");
const otherEmail = testEmailAddress("lane-controls-other");

// The account cases drive these controls on the lane's page, so each runs
// through the real argv runner's session, as in the lane.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

// Hands React props with the named handlers to the element, as React's own
// `__reactProps$` key carries them.
const reactProps = (selector: string, handlers: readonly string[]) =>
  `document.querySelector(${JSON.stringify(selector)}).__reactProps$test = Object.fromEntries(${JSON.stringify(handlers)}.map((name) => [name, () => {}]));`;

const html = (body: string) =>
  new Response(
    `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );

const languageNames = { "cs-CZ": "Čeština", "en-US": "English (US)" };

/**
 * The account page the lane's controls meet, in the path's locale.
 * `hydrate=0` leaves the profile without React props, `dialogDelayMs`
 * delays the deletion dialog, `busy=1` blocks the page's main thread once it
 * has loaded, and `section=hidden` hides the profile and reservations.
 * `window.clicks` records the deletion controls clicked.
 */
const accountPage = (url: URL) => {
  const locale = url.pathname.startsWith("/cs-CZ") ? "cs-CZ" : "en-US";
  const hydrate = url.searchParams.get("hydrate") !== "0";
  const hidden = url.searchParams.get("section") === "hidden" ? " hidden" : "";
  const dialogDelayMs = Number(url.searchParams.get("dialogDelayMs") ?? "0");
  const options = (["en-US", "cs-CZ"] as const)
    .map(
      (option) =>
        `<div role="option" aria-selected="${option === locale}" data-locale="${option}">${languageNames[option]}</div>`
    )
    .join("");
  return html(`<h1>${locale === "cs-CZ" ? "Účet" : "Account"}</h1>
    <section${hidden}><h2 id="account-reservations-past-title">Past</h2></section>
    <section data-screen="profile-screen"${hidden}>
      <input id="account-profile-email" readonly value="${laneEmail}">
      <fieldset><legend>Login email</legend><span>${laneEmail}</span></fieldset>
      <form id="account-profile-form">
        <input id="account-profile-first-name">
        <input id="account-profile-last-name">
        <input id="account-profile-phone">
        <input id="profile-referral-code" name="referralCode" value="SHARE-CODE">
        <select id="account-profile-billing-kind">
          <option value="personal">Personal</option>
          <option value="business">Business</option>
        </select>
        <input id="account-profile-billing-company-name">
        <button type="submit">Complete profile</button>
      </form>
      <label for="language">${locale === "cs-CZ" ? "Jazyk" : "Language"}</label>
      <button id="language" type="button" data-slot="select-trigger">${languageNames[locale]}</button>
    </section>
    <button id="delete-account-trigger" type="button">Delete</button>
    <div id="dialog"></div>
    <script>
      window.clicks = [];
      const record = (id) => window.clicks.push(id);
      document.getElementById("account-profile-form").addEventListener("submit", (event) => {
        event.preventDefault();
        event.target.querySelector("button[type=submit]").textContent = "Save profile";
      });
      document.getElementById("language").addEventListener("click", () => {
        const list = document.createElement("div");
        list.setAttribute("role", "listbox");
        list.innerHTML = ${JSON.stringify(options)};
        list.addEventListener("click", (event) => {
          const chosen = event.target.dataset.locale;
          location.assign("/" + chosen + "/account");
        });
        document.body.append(list);
      });
      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") document.querySelector('[role="listbox"]')?.remove();
      });
      document.getElementById("delete-account-trigger").addEventListener("click", () => {
        record("trigger");
        setTimeout(() => {
          const dialog = document.getElementById("dialog");
          dialog.innerHTML = '<input id="confirm-account-deletion" type="checkbox"><button id="delete-account-confirm" type="button">Confirm</button>';
          document.getElementById("confirm-account-deletion").addEventListener("click", () => record("checkbox"));
          document.getElementById("delete-account-confirm").addEventListener("click", () => {
            record("confirm");
            dialog.innerHTML = '<button id="delete-account-reauth-send" type="button">Send</button>';
            document.getElementById("delete-account-reauth-send").addEventListener("click", () => {
              record("send");
              dialog.textContent = "Link sent";
            });
          });
        }, ${dialogDelayMs});
      });
      ${hydrate ? `${reactProps("[data-screen='profile-screen']", ["onFocus"])}${reactProps("[data-screen='profile-screen'] [data-slot='select-trigger']", ["onPointerDown"])}` : ""}
      ${url.searchParams.get("busy") === "1" ? "setTimeout(() => { const end = Date.now() + 8000; while (Date.now() < end); }, 300);" : ""}
    </script>`);
};

/**
 * The pages the lane's controls meet. The session endpoint answers with the
 * lane email, or never once the page set the `stall-session` cookie.
 */
const server = Bun.serve({
  fetch: (request) => {
    const url = new URL(request.url);
    switch (url.pathname) {
      case "/api/auth/get-session":
        if (request.headers.get("cookie")?.includes("stall-session=1"))
          return new Promise<Response>(() => undefined);
        return Response.json({ user: { email: laneEmail } });
      case "/en-US/auth/sign-in":
        return html(`<form id="account-sign-in-form">
            <input id="account-sign-in-email" type="email">
            <button id="account-sign-in-submit" type="submit">Send</button>
          </form>
          <button type="button" id="another">Send another link</button>
          <input id="account-sign-in-code">
          <script>
            document.getElementById("account-sign-in-form").addEventListener("submit", (event) => event.preventDefault());
            document.getElementById("another").addEventListener("click", () => {
              document.getElementById("another").textContent = "Restarted";
            });
            const code = document.getElementById("account-sign-in-code");
            code.addEventListener("input", () => {
              if (code.value.length === 6) setTimeout(() => { code.value = ""; }, 200);
            });
            ${url.searchParams.get("stall") === "1" ? 'document.cookie = "stall-session=1; path=/";' : ""}
            ${url.searchParams.get("busy") === "1" ? "setTimeout(() => { const end = Date.now() + 8000; while (Date.now() < end); }, 300);" : ""}
          </script>`);
      case "/en-US/account":
      case "/cs-CZ/account":
        return accountPage(url);
      default:
        return html(`<p>Page ${url.pathname}</p>`);
    }
  },
  hostname: "127.0.0.1",
  port: 0,
});
const origin = server.url.origin;

afterAll(async () => {
  await browser?.close();
  await server.stop(true);
});

// Short bounds, so a control that never answers settles quickly.
const config = {
  baseUrl: origin,
  bypassSecret: undefined,
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 2000,
    browserNavigation: 3000,
    browserSessionClose: 1000,
    uiTransition: 2000,
  },
};

const laneBrowserFor = (run: Runner, session: string) =>
  makeWorkspaceE2EAccountLaneBrowser({ config, run, session });

type LaneBrowser = ReturnType<typeof laneBrowserFor>;

/** Runs `drive` on the lane browser of a fresh runner as one C03 step. */
const runLaneStep = <A>(
  drive: (laneBrowser: LaneBrowser) => Effect.Effect<A, WorkspaceE2EError>,
  options: {
    readonly afterStep?: (
      driver: BrowserStepDriver
    ) => Effect.Effect<void, WorkspaceE2EError>;
    readonly stepTimeoutMs?: number;
  } = {}
) => {
  if (!browser) throw new Error("Chromium is not running");
  return runBrowserStep({
    ...(options.afterStep ? { afterStep: options.afterStep } : {}),
    browser,
    drive: ({ id, run }: BrowserStepDriver) => drive(laneBrowserFor(run, id)),
    prepare: () => Effect.void,
    stepTimeoutMs: options.stepTimeoutMs ?? 15_000,
  });
};

test.skipIf(!chromiumAvailable)(
  "reads and drives the sign-in controls",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/auth/sign-in`);
        const sessionOfLane = yield* laneBrowser.readSessionMatches(laneEmail);
        const sessionOfOther =
          yield* laneBrowser.readSessionMatches(otherEmail);
        const blockedWhenEmpty = yield* laneBrowser.readSignInEmailBlocked;
        yield* laneBrowser.submitSignInEmail("not-an-email");
        const blocked = yield* laneBrowser.readSignInEmailBlocked;
        yield* laneBrowser.restartSignIn("Send another link");
        yield* laneBrowser.waitForText(
          "restarted sign-in",
          (text) => text.includes("Restarted"),
          2000
        );
        yield* laneBrowser.enterSignInCode("000000");
        yield* laneBrowser.waitForEmptiedSignInCode;
        return { blocked, blockedWhenEmpty, sessionOfLane, sessionOfOther };
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual({
      blocked: true,
      blockedWhenEmpty: false,
      sessionOfLane: true,
      sessionOfOther: false,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "fills, reads and saves the profile and billing drafts",
  async () => {
    const drafts = {
      billingCompanyName: "Draft Company",
      firstName: "Ada",
      lastName: "Lovelace",
      phone: "+420 601 000 000",
    };
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account`);
        const completionEmail =
          yield* laneBrowser.readCompletionLoginEmail(laneEmail);
        const completionOtherEmail =
          yield* laneBrowser.readCompletionLoginEmail(otherEmail);
        yield* laneBrowser.waitForReferralFieldValue("referral", "SHARE-CODE");
        yield* laneBrowser.fillProfileField("firstName", drafts.firstName);
        yield* laneBrowser.fillProfileField("lastName", drafts.lastName);
        yield* laneBrowser.fillProfileField("phone", drafts.phone);
        yield* laneBrowser.chooseBusinessBilling;
        yield* laneBrowser.fillProfileField(
          "billingCompanyName",
          drafts.billingCompanyName
        );
        const kept = yield* laneBrowser.readProfileDrafts(drafts);
        const changed = yield* laneBrowser.readProfileDrafts({
          ...drafts,
          billingCompanyName: "Other Company",
          phone: "+420 601 000 001",
        });
        yield* laneBrowser.saveProfile;
        yield* laneBrowser.waitForLinkedProfileForm("Save profile");
        const linkedEmail = yield* laneBrowser.readLinkedLoginEmail(laneEmail);
        const linkedOtherEmail =
          yield* laneBrowser.readLinkedLoginEmail(otherEmail);
        yield* laneBrowser.waitForReservationsPanel("reservations");
        yield* laneBrowser.waitForProfilePanel("profile");
        const snapshot = yield* laneBrowser.waitForSnapshot(
          "past reservations",
          (current) => current.includes("Past"),
          2000
        );
        return {
          changed,
          completionEmail,
          completionOtherEmail,
          kept,
          linkedEmail,
          linkedOtherEmail,
          snapshotHasHeading: snapshot.includes('heading "Past"'),
        };
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual({
      changed: { billingPreserved: false, profilePreserved: false },
      completionEmail: { matches: true, readOnly: true },
      completionOtherEmail: { matches: false, readOnly: true },
      kept: { billingPreserved: true, profilePreserved: true },
      linkedEmail: { editable: false, matches: true },
      // No fieldset shows the other email, which reads as editable.
      linkedOtherEmail: { editable: true, matches: false },
      snapshotHasHeading: true,
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "reads and saves the language through the profile's select",
  async () => {
    const result = await runLaneStep((laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account`);
        yield* laneBrowser.waitForPageHeading("English account", "Account");
        yield* laneBrowser.waitForLanguageControlLabel("English", "Language");
        yield* laneBrowser.openLanguageList;
        yield* laneBrowser.waitForSelectedLanguage("English selected", "en-US");
        const closed = yield* laneBrowser.dismissLanguageList;
        yield* laneBrowser.chooseLanguage("cs-CZ");
        const czech = yield* laneBrowser.waitForUrl(
          "Czech account",
          (url) => new URL(url).pathname === "/cs-CZ/account",
          2000
        );
        yield* laneBrowser.waitForProfilePanel("Czech profile");
        yield* laneBrowser.waitForLanguageControlLabel("Czech", "Jazyk");
        yield* laneBrowser.setLocaleCookie("en-US");
        return {
          closed,
          cookieCzech: yield* laneBrowser.hasLocaleCookie("cs-CZ"),
          cookieEnglish: yield* laneBrowser.hasLocaleCookie("en-US"),
          czech: new URL(czech).pathname,
        };
      })
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual({
      closed: true,
      cookieCzech: false,
      cookieEnglish: true,
      czech: "/cs-CZ/account",
    });
  }
);

test.skipIf(!chromiumAvailable)(
  "confirms the deletion and sends the reauthentication link",
  async () => {
    const result = await runLaneStep(
      (laneBrowser) =>
        Effect.gen(function* () {
          yield* laneBrowser.open(`${origin}/en-US/account`);
          yield* laneBrowser.confirmAccountDeletion;
          yield* laneBrowser.waitForReauthenticationDialog;
          yield* laneBrowser.sendReauthenticationLink;
          yield* laneBrowser.waitForText(
            "sent link",
            (text) => text.includes("Link sent"),
            2000
          );
        }),
      {
        afterStep: ({ session }) =>
          Effect.flatMap(
            session.evaluate("read clicks", () => window.clicks, undefined),
            (clicks) =>
              Effect.sync(() =>
                expect(clicks).toEqual([
                  "trigger",
                  "checkbox",
                  "confirm",
                  "send",
                ])
              )
          ),
      }
    );

    expect(result.annotations).toEqual([]);
  }
);

/** How each control that can't reach its page state fails its case. */
const failingControls: ReadonlyArray<
  readonly [
    string,
    "error" | "timeout",
    (laneBrowser: LaneBrowser) => Effect.Effect<unknown, WorkspaceE2EError>,
  ]
> = [
  [
    "a session read that never answers",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/auth/sign-in?stall=1`),
        laneBrowser.readSessionMatches(laneEmail)
      ),
  ],
  [
    "a validation read on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/auth/sign-in?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.readSignInEmailBlocked
        )
      ),
  ],
  [
    "a missing restart button",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/auth/sign-in`),
        laneBrowser.restartSignIn("Use a different email")
      ),
  ],
  [
    "a missing code input",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.enterSignInCode("000000")
      ),
  ],
  [
    "a code input that keeps its code",
    "timeout",
    (laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/auth/sign-in`);
        yield* laneBrowser.enterSignInCode("000");
        yield* laneBrowser.waitForEmptiedSignInCode;
      }),
  ],
  [
    "a completion email read on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.readCompletionLoginEmail(laneEmail)
        )
      ),
  ],
  [
    "another referral code",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForReferralFieldValue("referral", "OTHER-CODE")
      ),
  ],
  [
    "a hidden profile field",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?section=hidden`),
        laneBrowser.fillProfileField("lastName", "Lovelace")
      ),
  ],
  [
    "a hidden profile submit",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?section=hidden`),
        laneBrowser.saveProfile
      ),
  ],
  [
    "a profile form that is not the linked view",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForLinkedProfileForm("Save profile")
      ),
  ],
  [
    "a linked email read on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.readLinkedLoginEmail(laneEmail)
        )
      ),
  ],
  [
    "a hidden billing kind",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?section=hidden`),
        laneBrowser.chooseBusinessBilling
      ),
  ],
  [
    "a drafts read on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.readProfileDrafts({
            billingCompanyName: "",
            firstName: "",
            lastName: "",
            phone: "",
          })
        )
      ),
  ],
  [
    "a hidden reservations panel",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?section=hidden`),
        laneBrowser.waitForReservationsPanel("reservations")
      ),
  ],
  [
    "a snapshot that never matches",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForSnapshot("cancelled card", () => false, 1000)
      ),
  ],
  [
    "a deletion dialog that never opens",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?dialogDelayMs=60000`),
        laneBrowser.confirmAccountDeletion
      ),
  ],
  [
    "a reauthentication dialog that never opens",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForReauthenticationDialog
      ),
  ],
  [
    "a missing reauthentication button",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.sendReauthenticationLink
      ),
  ],
  [
    "a profile panel that is not hydrated",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?hydrate=0`),
        laneBrowser.waitForProfilePanel("profile")
      ),
  ],
  [
    "another language control label",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForLanguageControlLabel("Czech", "Jazyk")
      ),
  ],
  [
    "another heading",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account`),
        laneBrowser.waitForPageHeading("Czech account", "Účet")
      ),
  ],
  [
    "a language select that is not hydrated",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?hydrate=0`),
        laneBrowser.chooseLanguage("cs-CZ")
      ),
  ],
  [
    "a hidden language select",
    "timeout",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?section=hidden`),
        laneBrowser.openLanguageList
      ),
  ],
  [
    "another selected language",
    "timeout",
    (laneBrowser) =>
      Effect.gen(function* () {
        yield* laneBrowser.open(`${origin}/en-US/account`);
        yield* laneBrowser.openLanguageList;
        yield* laneBrowser.waitForSelectedLanguage("Czech selected", "cs-CZ");
      }),
  ],
  [
    "a cookie write on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.setLocaleCookie("en-US")
        )
      ),
  ],
  [
    "a cookie read on a busy page",
    "error",
    (laneBrowser) =>
      Effect.andThen(
        laneBrowser.open(`${origin}/en-US/account?busy=1`),
        Effect.andThen(
          Effect.sleep("500 millis"),
          laneBrowser.hasLocaleCookie("cs-CZ")
        )
      ),
  ],
];

test.skipIf(!chromiumAvailable)(
  "classifies each control that can't reach its page state",
  async () => {
    const results = [];
    // Two at a time, so busy pages don't starve each other's bounds.
    for (let index = 0; index < failingControls.length; index += 2) {
      results.push(
        ...(await Promise.all(
          failingControls
            .slice(index, index + 2)
            .map(async ([name, failureKind, drive]) => {
              const result = await runLaneStep(drive);
              return {
                annotations: result.annotations,
                expected: failedStepAnnotation(failureKind),
                name,
                timeout: result.failures.map(({ timeout }) => timeout),
              };
            })
        ))
      );
    }

    for (const { annotations, expected, name, timeout } of results) {
      expect({ annotations, name }).toEqual({ annotations: expected, name });
      expect({ name, timeout }).toEqual({
        name,
        timeout: [expected[0]?.failureKind === "timeout"],
      });
    }
  },
  180_000
);

test.skipIf(!chromiumAvailable)(
  "starts no later deletion click once the step deadline interrupts the dialog wait",
  async () => {
    const result = await runLaneStep(
      (laneBrowser) =>
        Effect.andThen(
          laneBrowser.open(`${origin}/en-US/account?dialogDelayMs=1500`),
          laneBrowser.confirmAccountDeletion
        ),
      {
        // The dialog opens after the deadline; a later click would find it.
        afterStep: ({ session }) =>
          Effect.gen(function* () {
            yield* Effect.sleep("2500 millis");
            const clicks = yield* session.evaluate(
              "read clicks",
              () => window.clicks,
              undefined
            );
            expect(clicks).toEqual(["trigger"]);
          }),
        stepTimeoutMs: 1000,
      }
    );

    expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
  }
);

declare global {
  interface Window {
    clicks: string[];
  }
}
