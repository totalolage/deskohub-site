import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration.
const { act, cleanup, fireEvent, render } = await import(
  "@testing-library/react"
);

type ConsentResponse = {
  readonly data: { readonly redirect: boolean; readonly url: string } | null;
  readonly error: { readonly status: number } | null;
};

const consent = mock(
  (_body: {
    readonly accept: boolean;
    readonly scope?: string;
  }): Promise<ConsentResponse> => Promise.resolve({ data: null, error: null })
);

mock.module("@/features/account/auth.client", () => ({
  authClient: { oauth2: { consent } },
}));

const { CustomerAgentConsent } = await import("./customer-agent-consent");
const { CustomerAgentNotice } = await import("./customer-agent-notice");

const locales = ["en-US", "cs-CZ"] as const;
const client = { name: "Synthetic Assistant", host: "assistant.invalid" };
const redirect = { host: "callback.invalid", local: false };
const redirectUrl = "https://assistant.invalid/callback?code=synthetic-code";
const navigations: string[] = [];
const originalAssign = window.location.assign;

const renderConsent = (locale: (typeof locales)[number]) =>
  render(
    <CustomerAgentConsent
      locale={locale}
      client={client}
      redirect={redirect}
      scopes={["offerings:read", "reservations:create", "offline_access"]}
    />
  );

afterAll(unregisterWorkspaceComponentTestEnv);

const buttons = (
  view: ReturnType<typeof render>,
  locale: (typeof locales)[number]
) => ({
  allow: view.getByRole("button", {
    name: m.customerAgentConsentAllow({}, { locale }),
  }) as HTMLButtonElement,
  deny: view.getByRole("button", {
    name: m.customerAgentConsentDeny({}, { locale }),
  }) as HTMLButtonElement,
});

describe("CustomerAgentConsent", () => {
  beforeEach(() => {
    window.location.assign = (url: string | URL) => {
      navigations.push(String(url));
    };
  });

  afterEach(() => {
    cleanup();
    consent.mockReset();
    navigations.length = 0;
    window.location.assign = originalAssign;
  });

  test.each(locales)(
    "names the assistant, its host, and what it can and can't do in %s",
    (locale) => {
      const view = renderConsent(locale);

      expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
        m.customerAgentConsentTitle({ client: client.name }, { locale })
      );
      for (const text of [
        m.customerAgentConsentHost({ host: client.host }, { locale }),
        m.customerAgentConsentRedirect({ host: redirect.host }, { locale }),
        m.customerAgentScopeOfferingsRead({}, { locale }),
        m.customerAgentScopeReservationsCreate({}, { locale }),
        m.customerAgentScopeOfflineAccess({}, { locale }),
        m.customerAgentConsentCannotPay({}, { locale }),
        m.customerAgentConsentCannotCancel({}, { locale }),
        m.customerAgentConsentCannotChangeAccount({}, { locale }),
        m.customerAgentConsentPaymentNote({}, { locale }),
      ]) {
        expect(view.getByText(text)).toBeTruthy();
      }
      expect(
        view.queryByText(m.customerAgentScopeReservationsRead({}, { locale }))
      ).toBeNull();
      expect(view.container.querySelector("img")).toBeNull();
      expect(view.getByRole("status").textContent).toBe("");
      expect(view.getByRole("alert").textContent).toBe("");
    }
  );

  test.each(locales)(
    "warns that access stays on the device for a loopback redirect in %s",
    (locale) => {
      const localRedirect = { host: "localhost", local: true };
      const view = render(
        <CustomerAgentConsent
          locale={locale}
          client={client}
          redirect={localRedirect}
          scopes={["reservations:read"]}
        />
      );

      const warning = view.getByText(
        m.customerAgentConsentLocalRedirect(
          { host: localRedirect.host, client: client.name },
          { locale }
        )
      );
      expect(warning.textContent).toContain(localRedirect.host);
      expect(
        view.queryByText(
          m.customerAgentConsentRedirect(
            { host: localRedirect.host },
            { locale }
          )
        )
      ).toBeNull();
    }
  );

  test("names the redirect host without a warning for a remote redirect", () => {
    const locale = "en-US";
    const view = renderConsent(locale);

    expect(
      view.getByText(
        m.customerAgentConsentRedirect({ host: redirect.host }, { locale })
      ).textContent
    ).toContain(redirect.host);
    expect(
      view.queryByText(
        m.customerAgentConsentLocalRedirect(
          { host: redirect.host, client: client.name },
          { locale }
        )
      )
    ).toBeNull();
  });

  test.each(locales)(
    "asks an administrator about administration apart from the rest in %s",
    async (locale) => {
      consent.mockResolvedValue({ data: null, error: { status: 500 } });
      const view = render(
        <CustomerAgentConsent
          locale={locale}
          client={client}
          redirect={redirect}
          scopes={["reservations:read"]}
          administration
        />
      );

      expect(
        view.getByRole("region", {
          name: m.customerAgentConsentAdministrationTitle({}, { locale }),
        })
      ).toBeTruthy();

      await act(async () => {
        fireEvent.click(buttons(view, locale).allow);
      });

      expect(consent).toHaveBeenCalledWith({
        accept: true,
        scope: "reservations:read administration",
      });
    }
  );

  test("never mentions administration to a customer", () => {
    const view = renderConsent("en-US");

    expect(view.queryByRole("region")).toBeNull();
  });

  test("leaves the host line out when the assistant has none", () => {
    const view = render(
      <CustomerAgentConsent
        locale="en-US"
        client={{ name: client.name }}
        redirect={redirect}
        scopes={["reservations:read"]}
      />
    );

    expect(
      view.queryByText(
        m.customerAgentConsentHost({ host: client.host }, { locale: "en-US" })
      )
    ).toBeNull();
  });

  test.each([
    [true, "allow"],
    [false, "deny"],
  ] as const)(
    "answers accept=%s and returns to the assistant's URL",
    async (accept, button) => {
      let answer: (response: ConsentResponse) => void = () => undefined;
      consent.mockImplementation(
        () =>
          new Promise((resolve) => {
            answer = resolve;
          })
      );
      const locale = "cs-CZ";
      const view = renderConsent(locale);

      await act(async () => {
        fireEvent.click(buttons(view, locale)[button]);
      });

      // Allow names exactly the listed scopes; Deny needs none.
      expect(consent).toHaveBeenCalledWith(
        accept
          ? {
              accept,
              scope: "offerings:read reservations:create offline_access",
            }
          : { accept }
      );
      expect(buttons(view, locale).allow.disabled).toBe(true);
      expect(buttons(view, locale).deny.disabled).toBe(true);
      expect(view.getByRole("status").textContent).toBe(
        m.customerAgentConsentSubmitting({}, { locale })
      );

      await act(async () => {
        answer({ data: { redirect: true, url: redirectUrl }, error: null });
      });

      expect(navigations).toEqual([redirectUrl]);
      expect(view.getByRole("status").textContent).toBe(
        m.customerAgentConsentReturning({ client: client.name }, { locale })
      );
      expect(buttons(view, locale).allow.disabled).toBe(true);
      expect(buttons(view, locale).deny.disabled).toBe(true);
    }
  );

  test("doesn't return to the assistant after the customer left the page", async () => {
    let answer: (response: ConsentResponse) => void = () => undefined;
    consent.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const locale = "en-US";
    const view = renderConsent(locale);

    await act(async () => {
      fireEvent.click(buttons(view, locale).allow);
    });
    view.unmount();
    await act(async () => {
      answer({ data: { redirect: true, url: redirectUrl }, error: null });
    });

    expect(navigations).toEqual([]);
  });

  test.each(locales)(
    "tells the customer to start again when the request expired in %s",
    async (locale) => {
      consent.mockResolvedValue({ data: null, error: { status: 400 } });
      const view = renderConsent(locale);

      await act(async () => {
        fireEvent.click(buttons(view, locale).allow);
      });

      expect(view.getByRole("alert").textContent).toBe(
        m.customerAgentConsentExpired({}, { locale })
      );
      expect(view.getByRole("status").textContent).toBe("");
      expect(buttons(view, locale).allow.disabled).toBe(true);
      expect(navigations).toEqual([]);
    }
  );

  test.each([
    [
      "a server error",
      () => Promise.resolve({ data: null, error: { status: 500 } }),
    ],
    ["a network failure", () => Promise.reject(new TypeError("fetch failed"))],
  ] as const)("offers a retry after %s", async (_label, respond) => {
    consent.mockImplementation(respond);
    const locale = "en-US";
    const view = renderConsent(locale);

    await act(async () => {
      fireEvent.click(buttons(view, locale).deny);
    });

    expect(view.getByRole("alert").textContent).toBe(
      m.customerAgentConsentFailed({}, { locale })
    );
    expect(buttons(view, locale).deny.disabled).toBe(false);
    expect(navigations).toEqual([]);

    consent.mockResolvedValue({
      data: { redirect: true, url: redirectUrl },
      error: null,
    });
    await act(async () => {
      fireEvent.click(buttons(view, locale).deny);
    });

    expect(consent).toHaveBeenLastCalledWith({ accept: false });
    expect(view.getByRole("alert").textContent).toBe("");
    expect(navigations).toEqual([redirectUrl]);
  });
});

describe("CustomerAgentNotice", () => {
  afterEach(cleanup);

  test.each(
    locales.flatMap((locale) =>
      (
        [
          [
            "unknown-request",
            m.customerAgentUnknownRequestTitle,
            m.customerAgentUnknownRequestBody,
          ],
          [
            "expired",
            m.customerAgentExpiredRequestTitle,
            m.customerAgentExpiredRequestBody,
          ],
          [
            "unavailable",
            m.customerAgentUnavailableTitle,
            m.customerAgentUnavailableBody,
          ],
          [
            "deletion-pending",
            m.customerAgentDeletionPendingTitle,
            m.customerAgentDeletionPendingBody,
          ],
          [
            "administration-only",
            m.customerAgentAdministrationOnlyTitle,
            m.customerAgentAdministrationOnlyBody,
          ],
        ] as const
      ).map(([notice, title, body]) => ({ locale, notice, title, body }))
    )
  )("explains $notice in $locale", ({ locale, notice, title, body }) => {
    const view = render(
      <CustomerAgentNotice locale={locale} notice={notice} />
    );

    expect(view.getByRole("heading", { level: 1 }).textContent).toBe(
      title({}, { locale })
    );
    expect(view.getByText(body({}, { locale }))).toBeTruthy();
    const accountLink = view.queryByRole("link", {
      name: m.customerAgentDeletionPendingAction({}, { locale }),
    });
    if (notice === "deletion-pending") {
      expect(accountLink?.getAttribute("href")).toBe(`/${locale}/account`);
    } else {
      expect(accountLink).toBeNull();
    }
  });
});
