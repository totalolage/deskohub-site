import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import type { CustomerAgentConnection } from "@/features/account/customer-agent-connections";
import { describeCustomerAgentScope } from "@/features/account/customer-agent-scope-copy";
import { m } from "@/features/i18n";
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
  connectedAt: "2026-10-01T09:30:00.000Z",
};
const unnamed: CustomerAgentConnection = {
  id: "consent-unnamed",
  name: undefined,
  host: undefined,
  scopes: [],
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

describe("CustomerAgentConnectionsSection", () => {
  afterEach(() => {
    cleanup();
    deleteConsent.mockReset();
    deleteConsent.mockImplementation(() => Promise.resolve({ error: null }));
  });

  for (const locale of locales) {
    test(`lists each assistant with its host, date, and permissions (${locale})`, () => {
      const view = renderSection(locale, [assistant, unnamed]);

      const list = view.getByRole("list", {
        name: m.accountSectionAssistants({}, { locale }),
      });
      const [named, generic] =
        list.querySelectorAll<HTMLElement>(":scope > li");
      expect(named?.textContent).toContain("Synthetic Assistant");
      expect(named?.textContent).toContain(
        m.accountAssistantDetails(
          {
            host: "assistant.invalid",
            date: formatInstantDate({
              instant: Temporal.Instant.from(assistant.connectedAt),
              locale,
              timeZone: workspaceSiteConstants.location.timeZone,
            }),
          },
          { locale }
        )
      );
      const scopes = within(named!).getByRole("list", {
        name: m.accountAssistantScopesLabel(
          { name: "Synthetic Assistant" },
          { locale }
        ),
      });
      expect(
        within(scopes)
          .getAllByRole("listitem")
          .map((item) => item.textContent)
      ).toEqual([
        describeCustomerAgentScope("reservations:read", locale),
        describeCustomerAgentScope("offline_access", locale),
      ]);
      // An assistant that names nothing still shows, so it can be
      // disconnected.
      expect(generic?.textContent).toContain(
        m.accountAssistantUnnamed({}, { locale })
      );
    });

    test(`shows an empty state without assistants (${locale})`, () => {
      const view = renderSection(locale, []);

      expect(
        view.getByText(m.accountAssistantsEmptyTitle({}, { locale }))
      ).toBeTruthy();
      expect(
        view.getByText(m.accountAssistantsEmptyBody({}, { locale }))
      ).toBeTruthy();
      expect(view.queryByRole("list")).toBeNull();
    });

    test(`explains a list that couldn't be read (${locale})`, () => {
      const view = renderSection(locale, null);

      expect(
        view.getByText(m.accountAssistantsUnavailable({}, { locale }))
      ).toBeTruthy();
      expect(
        view.queryByText(m.accountAssistantsEmptyTitle({}, { locale }))
      ).toBeNull();
    });

    test(`disconnects an assistant after confirmation (${locale})`, async () => {
      const view = renderSection(locale, [assistant]);
      const dialog = openDisconnect(view, locale, "Synthetic Assistant");

      expect(dialog.textContent).toContain(
        m.accountAssistantDisconnectTitle(
          { name: "Synthetic Assistant" },
          { locale }
        )
      );
      expect(dialog.textContent).toContain(
        m.accountAssistantDisconnectBody({}, { locale })
      );
      expect(deleteConsent).not.toHaveBeenCalled();
      await confirmDisconnect(dialog, locale);

      expect(deleteConsent).toHaveBeenCalledWith({ id: assistant.id });
      expect(view.queryByText("Synthetic Assistant")).toBeNull();
      expect(
        view.getByText(m.accountAssistantsEmptyTitle({}, { locale }))
      ).toBeTruthy();
      expect(view.container.querySelector("[aria-live='polite']")).toBeTruthy();
      expect(
        view.container.querySelector("#account-assistants-status")?.textContent
      ).toBe(m.accountAssistantDisconnected({}, { locale }));
    });
  }

  test("keeps the assistant and explains a failed disconnect", async () => {
    const locale = "en-US";
    deleteConsent.mockImplementation(() =>
      Promise.resolve({ error: { status: 500 } })
    );
    const view = renderSection(locale, [assistant]);
    const dialog = openDisconnect(view, locale, "Synthetic Assistant");

    await confirmDisconnect(dialog, locale);

    expect(dialog.textContent).toContain(
      m.accountAssistantDisconnectFailed({}, { locale })
    );
    expect(
      view.getAllByText("Synthetic Assistant", { exact: false }).length
    ).toBeGreaterThan(0);
    expect(
      view.container.querySelector("#account-assistants-status")?.textContent
    ).toBe("");
  });

  test("treats a network failure as a failed disconnect", async () => {
    const locale = "en-US";
    deleteConsent.mockImplementation(() =>
      Promise.reject(new Error("network down"))
    );
    const view = renderSection(locale, [assistant]);
    const dialog = openDisconnect(view, locale, "Synthetic Assistant");

    await confirmDisconnect(dialog, locale);

    expect(dialog.textContent).toContain(
      m.accountAssistantDisconnectFailed({}, { locale })
    );
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
  });
});
