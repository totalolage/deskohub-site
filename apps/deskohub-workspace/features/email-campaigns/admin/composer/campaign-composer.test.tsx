import { afterAll, afterEach, beforeEach, expect, mock, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { workspaceUseAction } from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import {
  campaignAudienceIdSchema,
  campaignIdSchema,
} from "../../campaign-identifiers";
import type { CampaignDelivery } from "../../campaign-states";
import type { AudienceOption } from "../audiences/audience-page-data.server";
import {
  type CampaignComposerFields,
  newCampaignComposerFields,
} from "./campaign-composer-fields";

mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));
mock.module("../editor/actions", () => ({
  authorizeCampaignImageUpload: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM detects the DOM when it loads, so it loads after it.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { captureCampaignOperations } = await import(
  "../campaign-operation-actions.test-utils"
);
const operations = captureCampaignOperations();

beforeEach(() => {
  workspaceUseAction.mockReset();
  workspaceUseAction.mockImplementation(
    () => ({ execute: mock(), isExecuting: false }) as never
  );
});
afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const audiences: readonly AudienceOption[] = [
  {
    id: campaignAudienceIdSchema.make("synthetic-audience-1"),
    title: "Regular coworkers",
    summary: "Customers with a cowork reservation",
    singleLocale: undefined,
  },
  {
    id: campaignAudienceIdSchema.make("synthetic-audience-2"),
    title: "Meeting room bookers",
    summary: "Customers with a meeting room reservation",
    singleLocale: undefined,
  },
];

const initialFields: CampaignComposerFields = {
  ...newCampaignComposerFields,
  title: "Synthetic campaign",
};

const renderComposer = async (
  delivery: CampaignDelivery | undefined,
  locale: Locale = "en-US"
) => {
  const { CampaignComposer } = await import("./campaign-composer");
  return render(
    <RouteLocaleProvider locale={locale}>
      <CampaignComposer
        adminInbox={null}
        audiences={audiences}
        campaign={
          delivery === undefined
            ? undefined
            : {
                id: campaignIdSchema.make("synthetic-campaign"),
                contentLocales: [],
                delivery,
                readOnly: false,
              }
        }
        initialFields={initialFields}
        templates={[]}
      />
    </RouteLocaleProvider>
  );
};

type ComposerView = Awaited<ReturnType<typeof renderComposer>>;

const audienceLabel = (delivery: CampaignDelivery, locale: Locale) =>
  ({
    once: m.emailCampaignsComposerAudienceLabel,
    automated: m.emailAutomationsComposerAudienceLabel,
  })[delivery]({}, { locale });

/** Opens the audience select and returns the options it offers. */
const audienceOptions = async (
  view: ComposerView,
  delivery: CampaignDelivery,
  locale: Locale = "en-US"
) => {
  await act(async () => {
    fireEvent.keyDown(
      view.getByRole("combobox", { name: audienceLabel(delivery, locale) }),
      { key: "Enter" }
    );
  });
  return view.getAllByRole("option");
};

const noAudienceOption = (view: ComposerView, locale: Locale = "en-US") =>
  view.queryByRole("option", {
    name: m.emailCampaignsComposerAudienceNone({}, { locale }),
  });

test.each([
  ["en-US", "once"],
  ["cs-CZ", "once"],
  ["en-US", "automated"],
  ["cs-CZ", "automated"],
] as const)(
  "offers “No audience” in %s only for a one-off campaign (%s)",
  async (locale, delivery) => {
    const view = await renderComposer(delivery, locale);
    const options = await audienceOptions(view, delivery, locale);
    if (delivery === "once") {
      expect(options).toHaveLength(audiences.length + 1);
      expect(noAudienceOption(view, locale)).not.toBeNull();
    } else {
      expect(options).toHaveLength(audiences.length);
      expect(noAudienceOption(view, locale)).toBeNull();
    }
  }
);

test("drops “No audience” once a new campaign is made automated", async () => {
  const view = await renderComposer(undefined);
  expect(await audienceOptions(view, "once")).toHaveLength(
    audiences.length + 1
  );
  await act(async () => {
    fireEvent.keyDown(view.getByRole("listbox"), { key: "Escape" });
  });
  const automated = view
    .getAllByRole("radio")
    .find(
      (radio) =>
        radio.getAttribute("name") === "delivery" &&
        radio.getAttribute("value") === "automated"
    );
  if (!automated) throw new Error("no automated delivery choice");
  await act(async () => {
    fireEvent.click(automated);
  });
  expect(await audienceOptions(view, "automated")).toHaveLength(
    audiences.length
  );
  expect(noAudienceOption(view)).toBeNull();
});

test("keeps edits made while a save is in flight unsaved", async () => {
  operations.install();
  const view = await renderComposer("once");
  const title = view.getByRole("textbox", {
    name: m.emailCampaignsComposerTitleLabel({}, { locale: "en-US" }),
  });
  const composerForm = view.container.querySelector("#campaign-composer");
  if (!composerForm) throw new Error("no composer form");

  await act(async () => {
    fireEvent.change(title, { target: { value: "Saved title" } });
  });
  await act(async () => {
    fireEvent.submit(composerForm);
  });
  expect(operations.requests("updateCampaign")).toHaveLength(1);

  await act(async () => {
    fireEvent.change(title, { target: { value: "Edited during save" } });
  });
  operations.respond("updateCampaign", { _tag: "Success", output: {} });

  expect(title).toHaveProperty("value", "Edited during save");
  expect(
    view.getByRole("button", {
      name: m.emailCampaignsComposerSaveDraft({}, { locale: "en-US" }),
    })
  ).toHaveProperty("disabled", false);
});

test("a save after a failed one marks the fields it sent saved", async () => {
  operations.install();
  const view = await renderComposer("once");
  const title = view.getByRole("textbox", {
    name: m.emailCampaignsComposerTitleLabel({}, { locale: "en-US" }),
  });
  const saveDraft = () =>
    view.getByRole("button", {
      name: m.emailCampaignsComposerSaveDraft({}, { locale: "en-US" }),
    });
  const composerForm = view.container.querySelector("#campaign-composer");
  if (!composerForm) throw new Error("no composer form");

  await act(async () => {
    fireEvent.change(title, { target: { value: "Refused title" } });
  });
  await act(async () => {
    fireEvent.submit(composerForm);
  });
  operations.respond("updateCampaign", {
    _tag: "Failure",
    code: "campaign-not-editable",
    message: "Port message",
  });
  expect(saveDraft()).toHaveProperty("disabled", false);

  await act(async () => {
    fireEvent.change(title, { target: { value: "Saved title" } });
  });
  await act(async () => {
    fireEvent.submit(composerForm);
  });
  expect(operations.requests("updateCampaign")).toHaveLength(2);
  operations.respond("updateCampaign", { _tag: "Success", output: {} });

  expect(title).toHaveProperty("value", "Saved title");
  expect(saveDraft()).toHaveProperty("disabled", true);
});

test("holds the form while a new campaign is created and its page opens", async () => {
  operations.install();
  const view = await renderComposer(undefined);
  const held = () =>
    view.container.querySelector("#campaign-composer")?.hasAttribute("inert");
  const composerForm = view.container.querySelector("#campaign-composer");
  if (!composerForm) throw new Error("no composer form");
  await act(async () => {
    fireEvent.submit(composerForm);
  });
  expect(operations.requests("createCampaign")).toHaveLength(1);
  expect(held()).toBe(true);

  // The action stops executing before its success opens the new page.
  operations.respond("createCampaign", {
    _tag: "Success",
    output: { id: campaignIdSchema.make("synthetic-created") },
  });
  expect(held()).toBe(true);
  expect(
    view.getByRole("button", {
      name: m.emailCampaignsComposerCreateDraft({}, { locale: "en-US" }),
    })
  ).toHaveProperty("disabled", true);

  await act(async () => {
    fireEvent.submit(composerForm);
  });
  expect(operations.requests("createCampaign")).toHaveLength(1);
});
