import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarPreviewType as CalendarPreview } from "@deskohub/workspace-admin-api";
import {
  type Browser,
  chromium,
  type Locator,
  type Page,
} from "@playwright/test";
import { m } from "@/features/administration/i18n";
import { browserModuleStubPlugin } from "@/shared/testing/browser-module-stubs.test-utils";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { compileWorkspaceAppStyles } from "@/shared/testing/workspace-app-styles.test-utils";
import { escapeRegExp } from "@/shared/utils/escape-regexp";
import type { FlowStepValue } from "./automation-flow-form";
import type { AutomationFlowBuilderData } from "./automation-flow-page-data.server";

const locale = "en-US";
const harnessUrl = `http://automation-flow-builder.test/${locale}/admin/email-campaigns/flow`;

// The harness runs outside a Next.js app: the router records refreshes, and
// every campaign operation goes to the test instead of a server action.
const moduleStubs: Readonly<Record<string, string>> = {
  "next/link": `
    import { createElement } from "react";
    export default function Link({ href, prefetch: _prefetch, ...props }) {
      return createElement("a", { ...props, href: String(href) });
    }
  `,
  "next/navigation": `
    export const useRouter = () => ({ refresh: () => window.refreshRoute() });
  `,
  "./campaign-operations.actions": `
    export const runCampaignOperation = (request) =>
      window.runCampaignOperation(request);
  `,
};

const chromiumAvailable = await playwrightChromiumAvailable();
let browser: Browser | undefined;
let buildDirectory = "";
let browserBundlePath = "";
let appStyles = "";

beforeAll(async () => {
  if (!chromiumAvailable) return;
  buildDirectory = await mkdtemp(
    join(tmpdir(), "automation-flow-builder-browser-")
  );
  const build = await Bun.build({
    entrypoints: [
      join(import.meta.dir, "automation-flow-builder.browser-harness.tsx"),
    ],
    format: "iife",
    minify: true,
    naming: "automation-flow-builder-harness.js",
    outdir: buildDirectory,
    plugins: [browserModuleStubPlugin(moduleStubs)],
    target: "browser",
  });
  if (!build.success) {
    throw new Error(build.logs.map(({ message }) => message).join("\n"));
  }
  browserBundlePath = join(
    buildDirectory,
    "automation-flow-builder-harness.js"
  );

  appStyles = await compileWorkspaceAppStyles();

  browser = await chromium.launch({ headless: true });
});

afterAll(async () => {
  await browser?.close();
  if (buildDirectory)
    await rm(buildDirectory, { force: true, recursive: true });
});

const campaignId = "01990000-0000-7000-8000-000000000001";
const campaign = {
  id: campaignId,
  title: "Synthetic automated campaign",
  purpose: "marketing",
  templateKey: "workspace",
  delivery: "automated",
  status: "draft",
  audienceId: null,
  locales: [locale],
  createdAt: "2026-10-19T08:00:00Z",
  updatedAt: "2026-10-19T08:00:00Z",
  content: {},
};

const condition: FlowStepValue = {
  _tag: "Condition",
  id: "condition-1",
  filter: { _tag: "Group", operator: "and", filters: [] },
};
const wait: FlowStepValue = {
  _tag: "Wait",
  id: "wait-1",
  wait: { _tag: "Duration", count: 2, unit: "hour" },
};
const send: FlowStepValue = { _tag: "Send", id: "send" };

const automation = (
  flow: { readonly trigger: unknown; readonly steps: readonly FlowStepValue[] },
  trigger: { readonly kind: string; readonly frequency: unknown }
) => ({
  campaignId,
  status: "draft",
  flow,
  trigger,
  activeVersion: null,
  versionCount: 0,
  pendingChanges: false,
  activation: { _tag: "PreviewRequired" },
  updatedAt: "2026-10-19T08:00:00Z",
});

const atMostHourly = { maxFiresPerHour: 1, firesMoreThanHourly: false };

const eventFlow = automation(
  {
    trigger: { _tag: "ReservationFinished" },
    steps: [condition, wait, send],
  },
  { kind: "reservation-finished", frequency: null }
);

const scheduleFlow = automation(
  {
    trigger: {
      _tag: "Schedule",
      calendar: { weekdays: ["monday"], hours: [10] },
    },
    steps: [send],
  },
  { kind: "schedule", frequency: atMostHourly }
);

const noData: AutomationFlowBuilderData = {
  lookups: {},
  savedAudiences: [],
  calendarPreviews: {},
};

const calendarPreview = (
  description: string,
  firesMoreThanHourly: boolean
): CalendarPreview => ({
  description,
  nextStarts: ["2026-10-26T09:00:00Z"],
  frequency: {
    maxFiresPerHour: firesMoreThanHourly ? 4 : 1,
    firesMoreThanHourly,
  },
});

type CampaignOperationRequest = {
  readonly operation: string;
  readonly input: unknown;
};

/**
 * Mounts the builder on its own page. `respond` answers each campaign
 * operation with the port's output; every request is recorded.
 */
const openBuilder = async ({
  automation: automationDetail,
  data = noData,
  respond,
}: {
  readonly automation: ReturnType<typeof automation>;
  readonly data?: AutomationFlowBuilderData;
  readonly respond: (request: CampaignOperationRequest) => Promise<unknown>;
}) => {
  if (!browser) throw new Error("The builder browser has not launched.");
  const page = await browser.newPage({
    reducedMotion: "reduce",
    viewport: { height: 900, width: 1280 },
  });
  const requests: CampaignOperationRequest[] = [];
  let routeRefreshes = 0;
  await page.exposeFunction(
    "runCampaignOperation",
    async (request: CampaignOperationRequest) => {
      requests.push(request);
      return { data: { _tag: "Success", output: await respond(request) } };
    }
  );
  await page.exposeFunction("refreshRoute", () => {
    routeRefreshes += 1;
  });
  const fixture = JSON.stringify({
    campaign,
    automation: automationDetail,
    data,
  });
  await page.route(harnessUrl, (route) =>
    route.fulfill({
      body: `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"></head><body><script type="application/json" id="automation-flow-builder-fixture">${fixture}</script><div id="automation-flow-builder-root" data-locale="${locale}"></div></body></html>`,
      contentType: "text/html",
    })
  );
  await page.goto(harnessUrl);
  await page.addStyleTag({ content: appStyles });
  await page.addScriptTag({ path: browserBundlePath });
  await saveButton(page).waitFor();
  return {
    page,
    /** The inputs `operation` was run with, in order. */
    inputsOf: (operation: string) =>
      requests
        .filter((request) => request.operation === operation)
        .map(({ input }) => input),
    routeRefreshes: () => routeRefreshes,
  };
};

const unexpectedOperation = async (request: CampaignOperationRequest) => {
  throw new Error(`Unexpected campaign operation ${request.operation}.`);
};

const insertPoint = (page: Page, position: number) =>
  page.getByRole("button", {
    exact: true,
    name: m.emailAutomationFlowInsertLabel({ position }, { locale }),
  });

const stepMenu = (page: Page, kind: FlowStepValue["_tag"], number: number) =>
  page.getByRole("button", {
    exact: true,
    name: m.emailAutomationFlowStepMenuLabel(
      {
        step: m.emailAutomationFlowStepEyebrow(
          { number, kind: kind.toLowerCase() },
          { locale }
        ),
      },
      { locale }
    ),
  });

/** The open menu's item whose name starts with `label`; some add a hint. */
const menuItem = (page: Page, label: string) =>
  page
    .getByRole("menu")
    .getByRole("menuitem", { name: new RegExp(`^${escapeRegExp(label)}`) });

// Its name turns to the saving label while a save is in flight.
const saveButton = (page: Page) => page.locator('button[type="submit"]');

const discardButton = (page: Page) =>
  page.getByRole("button", {
    exact: true,
    name: m.emailAutomationFlowDiscard({}, { locale }),
  });

const waitCount = (page: Page) =>
  page.getByRole("spinbutton", {
    exact: true,
    name: m.emailAutomationFlowWaitCountLabel({}, { locale }),
  });

const enabled = (locator: Locator) =>
  locator.and(locator.page().locator(":enabled"));
const disabled = (locator: Locator) =>
  locator.and(locator.page().locator(":disabled"));

const waitForFocus = (locator: Locator) =>
  locator.and(locator.page().locator(":focus")).waitFor();

const waitForMenuToClose = (page: Page) =>
  page.getByRole("menu").waitFor({ state: "detached" });

const withBuilder = async (
  options: Parameters<typeof openBuilder>[0],
  run: (builder: Awaited<ReturnType<typeof openBuilder>>) => Promise<void>
) => {
  const builder = await openBuilder(options);
  try {
    await run(builder);
  } finally {
    await builder.page.close();
  }
};

test.skipIf(!chromiumAvailable)(
  "inserts a step from the keyboard and returns focus to its insert point",
  () =>
    withBuilder(
      { automation: eventFlow, respond: unexpectedOperation },
      async ({ page }) => {
        await insertPoint(page, 1).focus();
        await page.keyboard.press("Enter");
        await waitForFocus(
          menuItem(page, m.emailAutomationFlowInsertCondition({}, { locale }))
        );
        await page.keyboard.press("ArrowDown");
        await waitForFocus(
          menuItem(page, m.emailAutomationFlowInsertWait({}, { locale }))
        );
        await page.keyboard.press("Enter");

        await stepMenu(page, "Wait", 1).waitFor();
        await stepMenu(page, "Condition", 2).waitFor();
        await waitForMenuToClose(page);
        // The insert point that opened the menu now sits before the
        // condition, which moved to step 2.
        await waitForFocus(insertPoint(page, 2));
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "inserts a step with the pointer before the send",
  () =>
    withBuilder(
      { automation: eventFlow, respond: unexpectedOperation },
      async ({ page }) => {
        await insertPoint(page, 3).click();
        await menuItem(
          page,
          m.emailAutomationFlowInsertCondition({}, { locale })
        ).click();

        await stepMenu(page, "Condition", 3).waitFor();
        await insertPoint(page, 4).waitFor();
        await waitForMenuToClose(page);
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "moves a step from its keyboard menu and keeps focus on that step's menu",
  () =>
    withBuilder(
      { automation: eventFlow, respond: unexpectedOperation },
      async ({ page }) => {
        await stepMenu(page, "Condition", 1).focus();
        await page.keyboard.press("Enter");
        // The first step can't move up, so the menu opens on Move down.
        await waitForFocus(
          menuItem(page, m.emailAutomationFlowStepMoveDown({}, { locale }))
        );
        expect(
          await menuItem(
            page,
            m.emailAutomationFlowStepMoveUp({}, { locale })
          ).isDisabled()
        ).toBe(true);
        await page.keyboard.press("Enter");

        await stepMenu(page, "Wait", 1).waitFor();
        await waitForFocus(stepMenu(page, "Condition", 2));
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "deletes a step from its menu without dropping focus to the page",
  () =>
    withBuilder(
      { automation: eventFlow, respond: unexpectedOperation },
      async ({ page }) => {
        await stepMenu(page, "Wait", 2).click();
        await menuItem(
          page,
          m.emailAutomationFlowStepDelete({}, { locale })
        ).click();

        await stepMenu(page, "Wait", 2).waitFor({ state: "detached" });
        await waitForMenuToClose(page);
        // Any control left in the flow will do; the page itself won't.
        await page.locator("form :focus").waitFor({ timeout: 2000 });
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "switches a wait between a duration and a calendar from its segments",
  () =>
    withBuilder(
      {
        automation: eventFlow,
        respond: async (request) =>
          request.operation === "previewCalendarExpression"
            ? calendarPreview("Synthetic wait until 10:00", false)
            : unexpectedOperation(request),
      },
      async ({ page, inputsOf }) => {
        const mode = (name: string) =>
          page.getByRole("radio", { exact: true, name });
        // The radios are visually hidden inside the segments a pointer hits.
        const segment = (name: string) =>
          page.locator("label", { has: mode(name) });
        const calendarMode = m.emailAutomationFlowWaitModeCalendar(
          {},
          { locale }
        );
        const durationMode = m.emailAutomationFlowWaitModeDuration(
          {},
          { locale }
        );
        const waitCalendar = page.locator('[data-calendar-usage="wait"]');

        await segment(calendarMode).click();

        await waitCalendar.waitFor();
        await waitCount(page).waitFor({ state: "detached" });
        expect(await mode(calendarMode).isChecked()).toBe(true);
        expect(inputsOf("previewCalendarExpression")).toEqual([
          { expression: { hours: [10] }, usage: "wait", locale },
        ]);

        await segment(durationMode).click();

        await waitCount(page).waitFor();
        await waitCalendar.waitFor({ state: "detached" });
        expect(await mode(durationMode).isChecked()).toBe(true);
        expect(inputsOf("previewCalendarExpression")).toHaveLength(1);
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "warns on the trigger once an edited schedule's preview fires more than hourly",
  () =>
    withBuilder(
      {
        automation: scheduleFlow,
        data: {
          ...noData,
          calendarPreviews: {
            "#trigger": {
              _tag: "Ready",
              description: "Synthetic Mondays at 10:00",
              nextStarts: [],
              frequency: atMostHourly,
            },
          },
        },
        respond: async (request) =>
          request.operation === "previewCalendarExpression"
            ? calendarPreview("Synthetic Mondays at 10:00 and 11:00", true)
            : unexpectedOperation(request),
      },
      async ({ page, inputsOf }) => {
        expect(await page.getByRole("note").count()).toBe(0);

        await page
          .getByRole("group", {
            exact: true,
            name: m.emailAutomationFlowCalendarPart(
              { part: "hours" },
              { locale }
            ),
          })
          .getByRole("button", { exact: true, name: "11:00" })
          .click();

        await page.getByRole("note").waitFor();
        expect(inputsOf("previewCalendarExpression")).toEqual([
          {
            expression: { weekdays: ["monday"], hours: [10, 11] },
            usage: "trigger",
            locale,
          },
        ]);
      }
    )
);

test.skipIf(!chromiumAvailable)(
  "discards edits, then saves the flow once and locks it while saving",
  () => {
    const saveSettled = Promise.withResolvers<void>();
    return withBuilder(
      {
        automation: eventFlow,
        respond: async (request) => {
          if (request.operation !== "updateAutomationFlow") {
            return unexpectedOperation(request);
          }
          await saveSettled.promise;
          const { flow } = request.input as { readonly flow: unknown };
          return { ...eventFlow, flow };
        },
      },
      async ({ page, inputsOf, routeRefreshes }) => {
        await disabled(saveButton(page)).waitFor();
        await disabled(discardButton(page)).waitFor();

        await waitCount(page).fill("5");
        await enabled(saveButton(page)).waitFor();
        await enabled(discardButton(page)).click();
        await disabled(saveButton(page)).waitFor();
        expect(await waitCount(page).inputValue()).toBe("2");

        await waitCount(page).fill("3");
        await enabled(saveButton(page)).click();
        await disabled(waitCount(page)).waitFor();
        expect(await saveButton(page).isDisabled()).toBe(true);
        expect(await discardButton(page).isDisabled()).toBe(true);
        saveSettled.resolve();

        await enabled(waitCount(page)).waitFor();
        await disabled(saveButton(page)).waitFor();
        await disabled(discardButton(page)).waitFor();
        expect(inputsOf("updateAutomationFlow")).toEqual([
          {
            campaignId,
            flow: {
              trigger: { _tag: "ReservationFinished" },
              steps: [
                condition,
                { ...wait, wait: { _tag: "Duration", count: 3, unit: "hour" } },
                send,
              ],
            },
          },
        ]);
        expect(routeRefreshes()).toBe(1);
      }
    );
  }
);
