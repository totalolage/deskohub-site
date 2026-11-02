import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  administrationHref,
  localizeAdministrationHref,
} from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { AudienceFilter } from "../../audience-filter";
import { campaignAudienceIdSchema } from "../../campaign-identifiers";
import { describeCampaignOperationFailure } from "../campaign-operation-failure";
import {
  audienceDeleteFailureCopy,
  audienceSaveFailureCopy,
} from "./audience-failure-copy";
import { newCondition } from "./audience-filter-editing";
import type { AudienceEditorData } from "./audience-page-data.server";

const navigation = await import("next/navigation");
mock.module("next/navigation", () => ({
  ...navigation,
  useParams: () => ({ locale: "en-US" }),
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
  }),
  // The audience list's export control runs browser Effects, whose runner
  // rethrows only Next control flow, which these tests never raise.
  unstable_rethrow: () => {},
}));

mock.module("../campaign-operations.actions", () => ({
  runCampaignOperation: mock(),
}));

registerWorkspaceComponentTestEnv();
// React DOM, which @testing-library/react and the operation capture load,
// must load after the happy-dom registration to handle input events.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);
const { captureCampaignOperations } = await import(
  "../campaign-operation-actions.test-utils"
);
const { audienceHref } = await import("./audience-list");
const { AudienceEditorPage } = await import("./audience-editor");

const locale = "en-US";
const operations = captureCampaignOperations();

beforeEach(() => {
  operations.install();
  workspaceRouterPush.mockClear();
  workspaceRouterRefresh.mockClear();
});
afterEach(() => cleanup());
afterAll(() => unregisterWorkspaceComponentTestEnv());

const audienceId = campaignAudienceIdSchema.make("synthetic-audience");

const everyone: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [],
};

const czechSpeakers: AudienceFilter = {
  _tag: "Group",
  operator: "and",
  filters: [{ ...newCondition("locale"), value: ["cs-CZ"] } as never],
};

const savedAudience = (
  overrides: Partial<AudienceEditorData> = {}
): AudienceEditorData => ({
  id: audienceId,
  title: "Synthetic regulars",
  filter: everyone,
  archived: false,
  ...overrides,
});

const renderEditor = (audience?: AudienceEditorData) =>
  render(
    <RouteLocaleProvider locale={locale}>
      <AudienceEditorPage audience={audience} />
    </RouteLocaleProvider>
  );

type View = ReturnType<typeof renderEditor>;

const button = (view: View, name: string) =>
  view.queryByRole("button", { name });

const titleInput = (view: View) =>
  view.getByRole("textbox", {
    name: m.emailCampaignsAudienceEditorTitleLabel({}, { locale }),
  }) as HTMLInputElement;

const submitButton = (view: View) =>
  view
    .getAllByRole("button")
    .find(
      (candidate) => candidate.getAttribute("type") === "submit"
    ) as HTMLButtonElement;

const typeTitle = async (view: View, title: string) => {
  await act(async () => {
    fireEvent.input(titleInput(view), { target: { value: title } });
  });
};

const submit = async (view: View) => {
  await act(async () => {
    fireEvent.click(submitButton(view));
  });
};

/** The live-region role announcing `text`. */
const announcedAs = (view: View, text: string) =>
  view.getByText(text).closest("[role]")?.getAttribute("role");

const heading = (view: View) => view.getByRole("heading", { level: 1 });

const archivedNotice = (view: View) =>
  view.queryByText(
    m.emailCampaignsAudienceEditorArchivedNotice({}, { locale })
  );

const label = {
  archive: m.emailCampaignsAudienceArchive({}, { locale }),
  unarchive: m.emailCampaignsAudienceUnarchive({}, { locale }),
  delete: m.emailCampaignsAudienceDelete({}, { locale }),
};

describe("a new audience", () => {
  test("has the new-audience title and no audience actions", () => {
    const view = renderEditor();
    expect(heading(view).textContent).toBe(
      m.emailCampaignsAudienceEditorNewTitle({}, { locale })
    );
    expect(button(view, label.archive)).toBeNull();
    expect(button(view, label.unarchive)).toBeNull();
    expect(button(view, label.delete)).toBeNull();
    expect(archivedNotice(view)).toBeNull();
    expect(titleInput(view).value).toBe("");
    expect(submitButton(view).textContent).toBe(
      m.emailCampaignsAudienceEditorCreate({}, { locale })
    );
    expect(submitButton(view).disabled).toBe(false);
  });

  test("refuses to create an audience without a title", async () => {
    const view = renderEditor();
    await submit(view);
    expect(titleInput(view).getAttribute("aria-invalid")).toBe("true");
    expect(operations.requests("createCampaignAudience")).toEqual([]);
  });

  test("creates the audience and opens it", async () => {
    const view = renderEditor();
    await typeTitle(view, "Synthetic newcomers");
    await submit(view);
    const [request] = operations.requests("createCampaignAudience");
    expect(request).toEqual({
      operation: "createCampaignAudience",
      input: {
        requestId: expect.any(String),
        audience: { title: "Synthetic newcomers", filter: everyone },
      },
    });
    expect(submitButton(view).textContent).toBe(
      m.emailCampaignsAudienceEditorSaving({}, { locale })
    );
    expect(submitButton(view).disabled).toBe(true);

    operations.respond("createCampaignAudience", {
      _tag: "Success",
      output: { id: "created-audience" },
    });
    expect(workspaceRouterPush.mock.calls).toEqual([
      [localizeAdministrationHref(audienceHref("created-audience"), locale)],
    ]);
  });

  test("shows a refused create as an alert", async () => {
    const view = renderEditor();
    await typeTitle(view, "Synthetic newcomers");
    await submit(view);
    const failure = {
      _tag: "Failure",
      code: "audience-title-taken",
      message: "Title taken",
    } as const;
    operations.respond("createCampaignAudience", failure);
    const message = describeCampaignOperationFailure(
      failure,
      audienceSaveFailureCopy,
      locale
    );
    expect(announcedAs(view, message)).toBe("alert");
    expect(workspaceRouterPush).not.toHaveBeenCalled();
    expect(submitButton(view).disabled).toBe(false);
  });
});

describe("a saved audience", () => {
  test("is titled by its name and offers archiving and deletion", () => {
    const view = renderEditor(savedAudience());
    expect(heading(view).textContent).toBe("Synthetic regulars");
    expect(
      view.getByText(m.emailCampaignsAudienceStatusActive({}, { locale }))
    ).toBeTruthy();
    expect(button(view, label.archive)).toBeTruthy();
    expect(button(view, label.unarchive)).toBeNull();
    expect(button(view, label.delete)).toBeTruthy();
    expect(archivedNotice(view)).toBeNull();
    expect(titleInput(view).value).toBe("Synthetic regulars");
    expect(submitButton(view).textContent).toBe(
      m.emailCampaignsAudienceEditorSave({}, { locale })
    );
  });

  test("can be saved only once changed", async () => {
    const view = renderEditor(savedAudience());
    expect(submitButton(view).disabled).toBe(true);
    await typeTitle(view, "Synthetic regulars, renamed");
    expect(submitButton(view).disabled).toBe(false);
  });

  test("saves the changes, confirms them, and refreshes", async () => {
    const view = renderEditor(savedAudience());
    await typeTitle(view, "Synthetic regulars, renamed");
    await submit(view);
    expect(operations.requests("updateCampaignAudience")).toEqual([
      {
        operation: "updateCampaignAudience",
        input: {
          audienceId,
          title: "Synthetic regulars, renamed",
          filter: everyone,
        },
      },
    ]);

    operations.respond("updateCampaignAudience", {
      _tag: "Success",
      output: {},
    });
    expect(
      announcedAs(view, m.emailCampaignsAudienceEditorSaved({}, { locale }))
    ).toBe("status");
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    // The saved values become the form's new baseline.
    expect(titleInput(view).value).toBe("Synthetic regulars, renamed");
    expect(submitButton(view).disabled).toBe(true);
  });

  test("an archived audience says so and offers restoring it", () => {
    const view = renderEditor(savedAudience({ archived: true }));
    expect(archivedNotice(view)).toBeTruthy();
    expect(
      view.getByText(m.emailCampaignsAudienceStatusArchived({}, { locale }))
    ).toBeTruthy();
    expect(button(view, label.unarchive)).toBeTruthy();
    expect(button(view, label.archive)).toBeNull();
    expect(button(view, label.delete)).toBeTruthy();
  });
});

describe("the filter summary", () => {
  test("notes the content a single-locale audience needs", () => {
    const view = renderEditor(savedAudience({ filter: czechSpeakers }));
    expect(
      view.getByText(
        m.emailCampaignsAudienceEditorSingleLocaleCzech({}, { locale })
      )
    ).toBeTruthy();
  });

  test("has no locale note when the audience spans every locale", () => {
    const view = renderEditor(savedAudience());
    for (const note of [
      m.emailCampaignsAudienceEditorSingleLocaleCzech,
      m.emailCampaignsAudienceEditorSingleLocaleEnglish,
    ]) {
      expect(view.queryByText(note({}, { locale }))).toBeNull();
    }
  });
});

describe("audience actions", () => {
  test("restores an archived audience and refreshes", async () => {
    const view = renderEditor(savedAudience({ archived: true }));
    await act(async () => {
      fireEvent.click(button(view, label.unarchive) as HTMLElement);
    });
    expect(operations.requests("unarchiveCampaignAudience")).toEqual([
      { operation: "unarchiveCampaignAudience", input: { audienceId } },
    ]);
    operations.respond("unarchiveCampaignAudience", {
      _tag: "Success",
      output: {},
    });
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  });

  test("archives the audience once confirmed and refreshes", async () => {
    const view = renderEditor(savedAudience());
    await act(async () => {
      fireEvent.click(button(view, label.archive) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(
        button(
          view,
          m.emailCampaignsAudienceArchiveConfirm({}, { locale })
        ) as HTMLElement
      );
    });
    expect(operations.requests("archiveCampaignAudience")).toEqual([
      { operation: "archiveCampaignAudience", input: { audienceId } },
    ]);
    operations.respond("archiveCampaignAudience", {
      _tag: "Success",
      output: {},
    });
    expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
  });

  test("deletes the audience once confirmed and returns to the list", async () => {
    const view = renderEditor(savedAudience());
    await act(async () => {
      fireEvent.click(button(view, label.delete) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(
        button(
          view,
          m.emailCampaignsAudienceDeleteConfirm({}, { locale })
        ) as HTMLElement
      );
    });
    expect(operations.requests("deleteCampaignAudience")).toEqual([
      { operation: "deleteCampaignAudience", input: { audienceId } },
    ]);
    operations.respond("deleteCampaignAudience", {
      _tag: "Success",
      output: {},
    });
    expect(workspaceRouterPush.mock.calls).toEqual([
      [
        localizeAdministrationHref(
          administrationHref("/[locale]/admin/email-audiences"),
          locale
        ),
      ],
    ]);
  });

  test("keeps the delete dialog open with the refusal", async () => {
    const view = renderEditor(savedAudience());
    await act(async () => {
      fireEvent.click(button(view, label.delete) as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(
        button(
          view,
          m.emailCampaignsAudienceDeleteConfirm({}, { locale })
        ) as HTMLElement
      );
    });
    const failure = {
      _tag: "Failure",
      code: "audience-in-use",
      message: "In use",
    } as const;
    operations.respond("deleteCampaignAudience", failure);
    expect(
      view.getByText(
        describeCampaignOperationFailure(
          failure,
          audienceDeleteFailureCopy,
          locale
        )
      )
    ).toBeTruthy();
    expect(workspaceRouterPush).not.toHaveBeenCalled();
  });
});
