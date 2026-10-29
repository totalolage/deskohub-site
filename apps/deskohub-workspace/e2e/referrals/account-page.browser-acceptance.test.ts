import { afterAll, beforeAll, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { type Browser, chromium } from "@playwright/test";
import { Deferred, Effect, Fiber } from "effect";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import type { E2EBrowserSession } from "../browser-session";
import { runE2ECase } from "../case-runner";
import {
  type BrowserStepDriver,
  failedStepAnnotation,
  runBrowserStep,
} from "../case-runner.browser.test-utils";
import type { WorkspaceE2EConfig } from "../config";
import type { WorkspaceE2EError } from "../errors";
import {
  assert,
  browserSessionFor,
  makePlaywrightBrowserRunner,
} from "../runtime";
import {
  type E2ETelemetryObservation,
  makeE2ETelemetryMock,
} from "../services/telemetry.mock";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  completeReferralProfile,
  isLinkedAccountView,
  isLinkedProfileEditForm,
  isProfileCompletionForm,
  linkedAccountViewQuery,
  linkedProfileEditFormQuery,
  openReferralAccount,
  toProfileCompletionFormQuery,
  waitForLinkedAccount,
  waitForProfileCompletionForm,
} from "./account-page";

// The referral cases' account page, driven through the browser session on a
// real Chromium: what each wait accepts, and how the case runner classifies
// each step's failures.
const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
});

const origin = "https://workspace.example.test";
// Short bounds, so a timeout shows within the test.
const config = {
  baseUrl: origin,
  timeouts: {
    ...workspaceE2ETimeouts,
    browserAction: 1000,
    browserNavigation: 5000,
    datasource: 500,
    uiTransition: 1000,
  },
} as WorkspaceE2EConfig;

const { completionTitle } = toProfileCompletionFormQuery("");
const elementId = (selector: string) => selector.replace(/^#/, "");
const completionForm = (code: string, name = "referralCode") =>
  `<h1>${completionTitle}</h1>
  <input id="profile-referral-code" name="${name}" value="${code}">`;
const linkedAccount = `<h2 id="${elementId(linkedAccountViewQuery.landmarkSelector)}">Past</h2>`;

/** The one failure of a step whose `label` action timed out. */
const timedOutAt = (label: string) => [
  { message: expect.stringMatching(new RegExp(`^${label} `)), timeout: true },
];

const showPage = (html: string) => (session: E2EBrowserSession) =>
  session.use("show the account page", (page) => page.setContent(html));

const runAccountStep = <A>(
  html: string,
  drive: (driver: BrowserStepDriver) => Effect.Effect<A, WorkspaceE2EError>,
  options: Omit<
    Parameters<typeof runBrowserStep>[0],
    "browser" | "drive" | "prepare"
  > = {}
) => {
  assert(browser, "Chromium is not running");
  return runBrowserStep({
    ...options,
    browser,
    drive,
    prepare: showPage(html),
  });
};

const evaluateOn = async <Arg>(
  html: string,
  condition: (arg: Arg) => unknown,
  arg: Arg
) => {
  assert(browser, "Chromium is not running");
  const page = await browser.newPage();
  try {
    await page.setContent(html);
    return await page.evaluate(
      condition as (arg: unknown) => unknown,
      arg as unknown
    );
  } finally {
    await page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "recognizes the completion form only with its referral field holding the code",
  async () => {
    const query = toProfileCompletionFormQuery("RFLSYNTHETICCODE");
    const shown = (html: string) =>
      evaluateOn(html, isProfileCompletionForm, query);

    expect(await shown(completionForm("RFLSYNTHETICCODE"))).toBe(true);
    expect(await shown(completionForm("RFLSYNTHETICOTHER"))).toBe(false);
    expect(await shown(completionForm(""))).toBe(false);
    expect(await shown(completionForm("RFLSYNTHETICCODE", "otherField"))).toBe(
      false
    );
    expect(
      await shown(
        '<input id="profile-referral-code" name="referralCode" value="RFLSYNTHETICCODE">'
      )
    ).toBe(false);
    expect(
      await shown(
        `<h1>${completionTitle}</h1><textarea id="profile-referral-code" name="referralCode">RFLSYNTHETICCODE</textarea>`
      )
    ).toBe(false);
    expect(
      await evaluateOn(
        completionForm(""),
        isProfileCompletionForm,
        toProfileCompletionFormQuery("")
      )
    ).toBe(true);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "recognizes the linked account view and the linked edit form",
  async () => {
    expect(
      await evaluateOn(
        linkedAccount,
        isLinkedAccountView,
        linkedAccountViewQuery
      )
    ).toBe(true);
    expect(
      await evaluateOn(
        `${linkedAccount}${completionForm("")}`,
        isLinkedAccountView,
        linkedAccountViewQuery
      )
    ).toBe(false);
    expect(
      await evaluateOn(
        "<main></main>",
        isLinkedAccountView,
        linkedAccountViewQuery
      )
    ).toBe(false);

    const editForm = (button: string) =>
      evaluateOn(
        `<form id="account-profile-form">${button}</form>`,
        isLinkedProfileEditForm,
        linkedProfileEditFormQuery
      );
    expect(
      await editForm(
        `<button type="submit"> ${linkedProfileEditFormQuery.submitLabel} </button>`
      )
    ).toBe(true);
    expect(await editForm('<button type="submit">Complete</button>')).toBe(
      false
    );
    expect(
      await editForm(
        `<button type="button">${linkedProfileEditFormQuery.submitLabel}</button>`
      )
    ).toBe(false);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "waits for the completion form and the linked view, and times out when they never show",
  async () => {
    const delayed = (html: string) =>
      `<main id="root"></main><script>setTimeout(() => {
        document.getElementById("root").innerHTML = ${JSON.stringify(html)};
      }, 200);</script>`;

    const completion = await runAccountStep(
      delayed(completionForm("RFLSYNTHETICCODE")),
      ({ session }) =>
        waitForProfileCompletionForm(session, config, "RFLSYNTHETICCODE")
    );
    expect(completion.annotations).toEqual([]);
    expect(completion.succeeded).toBe(true);

    const linked = await runAccountStep(delayed(linkedAccount), ({ session }) =>
      waitForLinkedAccount(session, config)
    );
    expect(linked.annotations).toEqual([]);

    const wrongCode = await runAccountStep(
      completionForm("RFLSYNTHETICOTHER"),
      ({ session }) =>
        waitForProfileCompletionForm(session, config, "RFLSYNTHETICCODE")
    );
    expect(wrongCode.annotations).toEqual(failedStepAnnotation("timeout"));
    expect(wrongCode.failures).toEqual(
      timedOutAt("wait for profile completion form with its referral field")
    );

    // Completion still shown: not linked yet.
    const unlinked = await runAccountStep(
      `${linkedAccount}${completionForm("")}`,
      ({ session }) => waitForLinkedAccount(session, config)
    );
    expect(unlinked.annotations).toEqual(failedStepAnnotation("timeout"));
    expect(unlinked.failures).toEqual(
      timedOutAt("wait for linked account view")
    );
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "opens the English account page with the shared link's search",
  async () => {
    let opened: string | undefined;
    const result = await runAccountStep(
      "<main></main>",
      ({ session }) =>
        Effect.andThen(
          session.use("serve the account page", (page) =>
            page.context().route(`${origin}/**`, (route) =>
              route.fulfill({
                body: completionForm("RFLSYNTHETICCODE"),
                contentType: "text/html; charset=utf-8",
              })
            )
          ),
          openReferralAccount(session, config, "?ref=RFLSYNTHETICCODE")
        ),
      {
        afterStep: ({ session }) =>
          session
            .use("read the opened URL", async (page) => page.url())
            .pipe(
              Effect.flatMap((url) =>
                Effect.sync(() => {
                  opened = url;
                })
              )
            ),
      }
    );

    expect(result.annotations).toEqual([]);
    expect(opened).toBe(`${origin}/en-US/account?ref=RFLSYNTHETICCODE`);
  },
  60_000
);

/**
 * The profile form. Its fields and submit control each have a hidden
 * duplicate after the visible one; `hydrated` attaches React-like handlers,
 * and a submit records the fields and, when `links`, turns the form into the
 * linked edit form.
 */
const profileForm = ({
  disabledSubmit = false,
  hydrateAfterMs = 0,
  links = true,
  readonlyPhone = false,
}: {
  readonly disabledSubmit?: boolean;
  readonly hydrateAfterMs?: number | null;
  readonly links?: boolean;
  readonly readonlyPhone?: boolean;
} = {}) => `<form id="account-profile-form">
    <input id="account-profile-first-name" name="firstName">
    <input id="account-profile-first-name" name="hiddenFirstName" hidden>
    <input id="account-profile-phone" name="phone"${readonlyPhone ? " readonly" : ""}>
    <input id="account-profile-phone" name="hiddenPhone" hidden>
    <button type="submit"${disabledSubmit ? " disabled" : ""}>Complete</button>
    <button type="submit" hidden>Complete</button>
  </form>
  <script>
    const form = document.getElementById("account-profile-form");
    window.submissions = [];
    const hydrate = () => {
      form.__reactProps$test = { onSubmit() {} };
      for (const field of form.elements) field.__reactProps$test = { onChange() {} };
    };
    ${hydrateAfterMs === null ? "" : `setTimeout(hydrate, ${hydrateAfterMs});`}
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.submissions.push({
        firstName: form.elements.firstName.value,
        hiddenFirstName: form.elements.hiddenFirstName.value,
        phone: form.elements.phone.value,
      });
      if (${links}) form.querySelector("button").textContent = ${JSON.stringify(linkedProfileEditFormQuery.submitLabel)};
    });
  </script>`;

const account = { name: "Synthetic Referral", phone: "+420 700 000 000" };

const readSubmissions = (session: E2EBrowserSession) =>
  session.evaluate(
    "read profile submissions",
    () => Reflect.get(window, "submissions") as unknown[],
    undefined,
    { timeoutMs: 5000 }
  );

test.skipIf(!chromiumAvailable)(
  "completes the profile through its visible fields and submits it once",
  async () => {
    const result = await runAccountStep(profileForm(), ({ session }) =>
      Effect.andThen(
        completeReferralProfile(session, config, account),
        readSubmissions(session)
      )
    );

    expect(result.annotations).toEqual([]);
    expect(result.value).toEqual([
      { firstName: account.name, hiddenFirstName: "", phone: account.phone },
    ]);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "times out each profile completion action that cannot finish",
  async () => {
    const cases = [
      {
        form: profileForm({ hydrateAfterMs: null }),
        label: "wait for browser React form handlers",
        submissions: [],
      },
      {
        form: profileForm({ readonlyPhone: true }),
        label: "fill browser field",
        submissions: [],
      },
      {
        form: profileForm({ disabledSubmit: true }),
        label: "click browser element",
        submissions: [],
      },
      {
        form: profileForm({ links: false }),
        label: "wait for linked account edit form after profile completion",
        submissions: [
          {
            firstName: account.name,
            hiddenFirstName: "",
            phone: account.phone,
          },
        ],
      },
    ];
    for (const { form, label, submissions } of cases) {
      let submitted: unknown[] | undefined;
      const result = await runAccountStep(
        form,
        ({ session }) => completeReferralProfile(session, config, account),
        {
          afterStep: ({ session }) =>
            readSubmissions(session).pipe(
              Effect.flatMap((read) =>
                Effect.sync(() => {
                  submitted = read;
                })
              )
            ),
        }
      );

      expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
      expect(result.failures).toEqual(timedOutAt(label));
      expect(submitted).toEqual(submissions);
    }
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fills nothing once a step deadline interrupts the handler wait",
  async () => {
    let fields: unknown;
    const result = await runAccountStep(
      profileForm({ hydrateAfterMs: 1500 }),
      ({ session }) =>
        completeReferralProfile(
          session,
          {
            ...config,
            timeouts: { ...config.timeouts, browserAction: 10_000 },
          },
          account
        ),
      {
        // Past the hydration the interrupted wait was still waiting for.
        afterStep: ({ session }) =>
          Effect.gen(function* () {
            yield* Effect.promise(() => Bun.sleep(2500));
            fields = yield* session.evaluate(
              "read profile fields",
              () =>
                [
                  ...document.querySelectorAll<HTMLInputElement>(
                    "#account-profile-form input"
                  ),
                ].map((input) => input.value),
              undefined,
              { timeoutMs: 5000 }
            );
          }),
        stepTimeoutMs: 500,
      }
    );

    expect(result.annotations).toEqual(failedStepAnnotation("timeout"));
    expect(fields).toEqual(["", "", "", ""]);
  },
  60_000
);

test.skipIf(!chromiumAvailable)(
  "fills nothing and cancels the step when the case is interrupted during the handler wait",
  async () => {
    assert(browser, "Chromium is not running");
    const run = makePlaywrightBrowserRunner(browser, { recordHar: false });
    const id = `referral-account-cancel-${randomUUID()}`;
    const observations: E2ETelemetryObservation[] = [];
    const started = Deferred.makeUnsafe<void>();
    try {
      const fiber = Effect.runFork(
        runE2ECase({
          body: (step) =>
            Effect.gen(function* () {
              const session = yield* browserSessionFor(run, id);
              yield* showPage(profileForm({ hydrateAfterMs: 2000 }))(session);
              yield* Deferred.succeed(started, undefined);
              yield* step({
                execute: completeReferralProfile(
                  session,
                  {
                    ...config,
                    timeouts: { ...config.timeouts, browserAction: 10_000 },
                  },
                  account
                ),
                id: "complete-profile",
                timeoutMs: 15_000,
              });
            }),
          caseId: "referral-account-cancel",
          watchdogMs: 60_000,
        }).pipe(Effect.provide(makeE2ETelemetryMock(observations)))
      );
      await Effect.runPromise(Deferred.await(started));
      await Bun.sleep(200);
      await Effect.runPromise(Fiber.interrupt(fiber));
      // Past the hydration the interrupted wait was still waiting for.
      await Bun.sleep(3000);
      const fields = await Effect.runPromise(
        Effect.flatMap(browserSessionFor(run, id), (session) =>
          session.evaluate(
            "read profile fields",
            () =>
              [
                ...document.querySelectorAll<HTMLInputElement>(
                  "#account-profile-form input"
                ),
              ].map((input) => input.value),
            undefined,
            { timeoutMs: 5000 }
          )
        )
      );

      expect(
        observations.flatMap((observation) =>
          observation.scope === "step" ? [observation.outcome] : []
        )
      ).toEqual(["cancelled"]);
      expect(fields).toEqual(["", "", "", ""]);
    } finally {
      await run.close?.();
    }
  },
  60_000
);
