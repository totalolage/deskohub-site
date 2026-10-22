import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import { m } from "@/features/i18n";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  type WorkspaceBrowserLogRecord,
} from "@/shared/browser/workspace-browser-logs";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { workspaceSiteConstants } from "@/shared/utils";
import { formatInstantDate } from "@/shared/utils/date-time-format";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render, within } = await import(
  "@testing-library/react"
);

type DeleteConsentResponse = {
  readonly error: { readonly status: number } | null;
};

const deleteConsent = mock(
  (_body: { readonly id: string }): Promise<DeleteConsentResponse> =>
    Promise.resolve({ error: null })
);

mock.module("@/features/account/auth.client", () => ({
  authClient: { oauth2: { deleteConsent } },
}));

const { CustomerAgentConnectionsSection } = await import(
  "./customer-agent-connections-section"
);

const locales = ["en-US", "cs-CZ"] as const;
type TestLocale = (typeof locales)[number];

const assistant: CustomerAgentConnection = {
  id: "consent-synthetic-assistant",
  name: "Synthetic Assistant",
  host: "assistant.invalid",
  scopes: ["reservations:read", "offline_access"],
  administration: false,
  connectedAt: "2026-10-01T09:30:00.000Z",
};
const unnamed: CustomerAgentConnection = {
  id: "consent-unnamed",
  name: undefined,
  host: undefined,
  scopes: [],
  administration: false,
  connectedAt: "2026-10-02T09:30:00.000Z",
};

const renderSection = (
  locale: TestLocale,
  connections: readonly CustomerAgentConnection[] | null
) =>
  render(
    <CustomerAgentConnectionsSection
      connections={connections}
      hidden={false}
      locale={locale}
    />
  );

const assistantsStateSelectors = {
  list: "ul[aria-labelledby='account-assistants-title']",
  empty: "#account-assistants-empty",
  unavailable: "#account-assistants-unavailable",
} as const;

/** Which of the section's list, empty, and unavailable states render. */
const renderedStates = (view: ReturnType<typeof render>) =>
  Object.entries(assistantsStateSelectors)
    .filter(([, selector]) => view.container.querySelector(selector) !== null)
    .map(([state]) => state);

const disconnectStatus = (view: ReturnType<typeof render>) =>
  view.container.querySelector("#account-assistants-status");

const disconnectFailure = (dialog: HTMLElement) =>
  dialog.querySelector("[aria-live='assertive']");

const openDisconnect = (
  view: ReturnType<typeof render>,
  locale: TestLocale,
  name: string
) => {
  fireEvent.click(
    view.getByRole("button", {
      name: m.accountAssistantDisconnectLabel({ name }, { locale }),
    })
  );
  return view.getByRole("dialog");
};

const confirmDisconnect = async (dialog: HTMLElement, locale: TestLocale) => {
  await act(async () => {
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: m.accountAssistantDisconnectConfirm({}, { locale }),
      })
    );
  });
};

afterAll(unregisterWorkspaceComponentTestEnv);

const reported: WorkspaceBrowserLogRecord[] = [];
discardWorkspaceBrowserLogs();
const detachLogs = deliverWorkspaceBrowserLogs((record) => {
  reported.push(record);
});
afterAll(detachLogs);

describe("CustomerAgentConnectionsSection", () => {
  afterEach(() => {
    cleanup();
    reported.length = 0;
    deleteConsent.mockReset();
    deleteConsent.mockImplementation(() => Promise.resolve({ error: null }));
  });

  for (const locale of locales) {
    test(`lists each assistant with its host, date, and permissions (${locale})`, () => {
      const view = renderSection(locale, [assistant, unnamed]);

      const list = view.container.querySelector<HTMLElement>(
        assistantsStateSelectors.list
      )!;
      const [named, generic] =
        list.querySelectorAll<HTMLElement>(":scope > li");
      expect(named?.dataset.assistantConnectionId).toBe(assistant.id);
      expect(named?.textContent).toContain("Synthetic Assistant");
      expect(named?.textContent).toContain("assistant.invalid");
      expect(named?.textContent).toContain(
        formatInstantDate({
          instant: Temporal.Instant.from(assistant.connectedAt),
          locale,
          timeZone: workspaceSiteConstants.location.timeZone,
        })
      );
      const scopes = within(named!).getByRole("list");
      expect(scopes.getAttribute("aria-label")).toContain(
        "Synthetic Assistant"
      );
      const scopeItems = within(scopes).getAllByRole("listitem");
      expect(scopeItems.map((item) => item.dataset.assistantScope)).toEqual([
        ...assistant.scopes,
      ]);
      for (const item of scopeItems) expect(item.textContent).toBeTruthy();
      // An assistant that names nothing still shows under a fallback name,
      // so it can be disconnected.
      expect(generic?.dataset.assistantConnectionId).toBe(unnamed.id);
      expect(generic?.querySelector("p")?.textContent).toBeTruthy();
      expect(within(generic!).getByRole("button")).toBeTruthy();
      expect(within(generic!).queryByRole("list")).toBeNull();
    });

    test(`shows an empty state without assistants (${locale})`, () => {
      const view = renderSection(locale, []);

      expect(renderedStates(view)).toEqual(["empty"]);
      expect(view.queryByRole("list")).toBeNull();
      // A title and a line on how to connect one.
      const emptyText = Array.from(
        view.container.querySelectorAll(`${assistantsStateSelectors.empty} p`),
        (paragraph) => paragraph.textContent
      );
      expect(emptyText).toHaveLength(2);
      for (const text of emptyText) expect(text).toBeTruthy();
    });

    test(`explains a list that couldn't be read (${locale})`, () => {
      const view = renderSection(locale, null);

      expect(renderedStates(view)).toEqual(["unavailable"]);
      expect(
        view.container.querySelector(assistantsStateSelectors.unavailable)
          ?.textContent
      ).toBeTruthy();
    });

    test(`disconnects an assistant after confirmation (${locale})`, async () => {
      const view = renderSection(locale, [assistant]);
      expect(disconnectStatus(view)?.getAttribute("aria-live")).toBe("polite");
      expect(disconnectStatus(view)?.textContent).toBe("");
      const dialog = openDisconnect(view, locale, "Synthetic Assistant");

      // The dialog names the assistant it disconnects and describes what
      // disconnecting does.
      expect(view.getByRole("dialog", { name: /Synthetic Assistant/ })).toBe(
        dialog
      );
      const description = (dialog.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent ?? "")
        .join("");
      expect(description).toBeTruthy();
      expect(deleteConsent).not.toHaveBeenCalled();
      await confirmDisconnect(dialog, locale);

      expect(deleteConsent).toHaveBeenCalledWith({ id: assistant.id });
      expect(view.queryByText("Synthetic Assistant")).toBeNull();
      expect(renderedStates(view)).toEqual(["empty"]);
      expect(disconnectStatus(view)?.textContent).toBeTruthy();
    });
  }

  test("keeps the assistant and explains a failed disconnect", async () => {
    const locale = "en-US";
    deleteConsent.mockImplementation(() =>
      Promise.resolve({ error: { status: 500 } })
    );
    const view = renderSection(locale, [assistant]);
    const dialog = openDisconnect(view, locale, "Synthetic Assistant");
    expect(disconnectFailure(dialog)?.textContent).toBe("");

    await confirmDisconnect(dialog, locale);

    expect(view.getByRole("dialog")).toBe(dialog);
    expect(disconnectFailure(dialog)?.textContent).toBeTruthy();
    expect(renderedStates(view)).toEqual(["list"]);
    expect(
      view.container.querySelector(
        `[data-assistant-connection-id="${assistant.id}"]`
      )
    ).toBeTruthy();
    expect(disconnectStatus(view)?.textContent).toBe("");
    expect(reported.map(({ attributes }) => attributes.failureCode)).toEqual([
      "account.customer-agent-disconnect.failed",
    ]);
  });

  test("treats a network failure as a failed disconnect", async () => {
    const locale = "en-US";
    deleteConsent.mockImplementation(() =>
      Promise.reject(new Error("network down"))
    );
    const view = renderSection(locale, [assistant]);
    const dialog = openDisconnect(view, locale, "Synthetic Assistant");

    expect(disconnectFailure(dialog)?.textContent).toBe("");

    await confirmDisconnect(dialog, locale);

    expect(view.getByRole("dialog")).toBe(dialog);
    expect(disconnectFailure(dialog)?.textContent).toBeTruthy();
    expect(renderedStates(view)).toEqual(["list"]);
    expect(reported.map(({ attributes }) => attributes.failureCode)).toEqual([
      "account.customer-agent-disconnect.failed",
    ]);
  });

  test("counts an assistant already disconnected elsewhere as disconnected", async () => {
    const locale = "en-US";
    deleteConsent.mockImplementation(() =>
      Promise.resolve({ error: { status: 404 } })
    );
    const view = renderSection(locale, [assistant]);
    const dialog = openDisconnect(view, locale, "Synthetic Assistant");

    await confirmDisconnect(dialog, locale);

    expect(view.queryByText("Synthetic Assistant")).toBeNull();
    expect(renderedStates(view)).toEqual(["empty"]);
    expect(reported).toEqual([]);
  });
});
