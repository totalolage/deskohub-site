import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

let currentPathname = "/en-US";
let currentSearch = "";
// Set while a test renders the prerendered shell, which cannot read the query.
let pendingSearch: Promise<never> | undefined;

mock.module("next/navigation", () => ({
  usePathname: () => currentPathname,
  useSearchParams: () => {
    if (pendingSearch) throw pendingSearch;
    return new URLSearchParams(currentSearch);
  },
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

beforeEach(() => {
  currentPathname = "/en-US";
  currentSearch = "";
  pendingSearch = undefined;
  window.location.href = "http://localhost/en-US";
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

const czech = m.languageCzech({}, { locale: "en-US" });

const localePreference = (signedIn: boolean) => {
  const saves: { locale: string }[] = [];
  const saved = Promise.withResolvers<void>();
  return {
    saves,
    saved,
    preference: {
      signedIn: Promise.resolve(signedIn),
      save: (input: { locale: "cs-CZ" | "en-US" }) => {
        saves.push(input);
        return saved.promise;
      },
    },
  };
};

test.each(["stacked", "inline"] as const)(
  "the prerendered shell shows the $0 labels without links until the query can be read",
  async (appearance) => {
    const { LocaleSwitcher } = await import("./locale-switcher");
    pendingSearch = new Promise<never>(() => undefined);

    const shell = render(
      <LocaleSwitcher locale="en-US" appearance={appearance} />
    );
    const shellMarkup = shell.container.innerHTML;
    shell.unmount();
    pendingSearch = undefined;
    const ready = render(
      <LocaleSwitcher locale="en-US" appearance={appearance} />
    );

    expect(shellMarkup).not.toContain("<a ");
    // The prerendered structure: the current language in <strong>, and in the
    // stacked appearance one span per language, later ones after a <br>.
    const shellView = document.createElement("div");
    shellView.innerHTML = shellMarkup;
    expect(shellView.querySelectorAll("strong")).toHaveLength(1);
    expect(
      [...shellView.children].map((child) => [
        child.tagName,
        child.querySelectorAll("br").length,
      ])
    ).toEqual(
      appearance === "stacked"
        ? [
            ["SPAN", 0],
            ["SPAN", 1],
          ]
        : [["STRONG", 0]]
    );
    expect(shellMarkup).toBe(
      ready.container.innerHTML.replace(/<a [^>]*>([^<]*)<\/a>/g, "$1")
    );
  }
);

test("names each language in the current locale's language and keeps the current one unlinked", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  currentPathname = "/cs-CZ";

  const view = render(<LocaleSwitcher locale="cs-CZ" appearance="stacked" />);

  expect(
    view.queryByRole("link", { name: m.languageCzech({}, { locale: "cs-CZ" }) })
  ).toBeNull();
  expect(view.getByText(m.languageCzech({}, { locale: "cs-CZ" })).tagName).toBe(
    "STRONG"
  );
  expect(
    view
      .getByRole("link", { name: m.languageEnglish({}, { locale: "cs-CZ" }) })
      .getAttribute("href")
  ).toBe("/en-US");
});

test("links the other locale to the current page with its query", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  currentPathname = "/en-US/pricing";
  currentSearch = "ref=menu";

  const view = render(<LocaleSwitcher locale="en-US" appearance="inline" />);

  expect(view.getByRole("link", { name: czech }).getAttribute("href")).toBe(
    "/cs-CZ/pricing?ref=menu"
  );
});

test("runs onSwitch when another locale's link is clicked", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const onSwitch = mock();

  const view = render(
    <LocaleSwitcher locale="en-US" appearance="inline" onSwitch={onSwitch} />
  );
  fireEvent.click(view.getByRole("link", { name: czech }));

  expect(onSwitch).toHaveBeenCalledTimes(1);
});

test("a signed-in switch saves the preference before navigating to the new locale", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const { saves, saved, preference } = localePreference(true);
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={preference}
    />
  );
  await act(() => preference.signedIn);

  fireEvent.click(view.getByRole("link", { name: czech }));

  await waitFor(() => expect(saves).toEqual([{ locale: "cs-CZ" }]));
  expect(window.location.pathname).toBe("/en-US");

  await act(async () => {
    saved.resolve();
    await saved.promise;
  });

  expect(window.location.pathname).toBe("/cs-CZ");
});

test("a signed-in modified click opens the link natively without saving", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const { saves, preference } = localePreference(true);
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={preference}
    />
  );
  await act(() => preference.signedIn);

  const notPrevented = fireEvent.click(
    view.getByRole("link", { name: czech }),
    {
      ctrlKey: true,
    }
  );

  expect(notPrevented).toBe(true);
  expect(saves).toEqual([]);
});

test("a signed-in switch still navigates when the save fails", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const saves: { locale: string }[] = [];
  const signedIn = Promise.resolve(true);
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={{
        signedIn,
        save: (input) => {
          saves.push(input);
          return Promise.reject(new Error("network unreachable"));
        },
      }}
    />
  );
  await act(() => signedIn);

  fireEvent.click(view.getByRole("link", { name: czech }));

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});

test("a guest switch stays a plain link without saving", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const { saves, preference } = localePreference(false);
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={preference}
    />
  );
  await act(() => preference.signedIn);

  const link = view.getByRole("link", { name: czech });
  const notPrevented = fireEvent.click(link);

  expect(notPrevented).toBe(true);
  expect(link.getAttribute("href")).toBe("/cs-CZ");
  expect(saves).toEqual([]);
});

test("a switch before the session check settles waits for it, then saves when signed in", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const signedIn = Promise.withResolvers<boolean>();
  const saves: { locale: string }[] = [];
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={{
        signedIn: signedIn.promise,
        save: (input) => {
          saves.push(input);
          return Promise.resolve();
        },
      }}
    />
  );

  const notPrevented = fireEvent.click(view.getByRole("link", { name: czech }));
  expect(notPrevented).toBe(false);
  expect(saves).toEqual([]);

  await act(async () => {
    signedIn.resolve(true);
    await signedIn.promise;
  });

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});

test("a guest switch before the session check settles navigates without saving", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const signedIn = Promise.withResolvers<boolean>();
  const saves: { locale: string }[] = [];
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={{
        signedIn: signedIn.promise,
        save: (input) => {
          saves.push(input);
          return Promise.resolve();
        },
      }}
    />
  );

  fireEvent.click(view.getByRole("link", { name: czech }));
  await act(async () => {
    signedIn.resolve(false);
    await signedIn.promise;
  });

  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([]);
});

// React hands a client component the server's streamed promise as a bare
// thenable: it has `then` and nothing else, so `catch` and `finally` are absent.
const bareThenable = <T,>(value: T): PromiseLike<T> => ({
  // biome-ignore lint/suspicious/noThenProperty: models React's streamed thenable.
  then: (onFulfilled, onRejected) =>
    Promise.resolve(value).then(onFulfilled, onRejected),
});

test("a signed-in switch with a streamed bare thenable saves, then navigates", async () => {
  const { LocaleSwitcher } = await import("./locale-switcher");
  const saves: { locale: string }[] = [];
  const signedIn = bareThenable(true);
  const view = render(
    <LocaleSwitcher
      locale="en-US"
      appearance="stacked"
      localePreference={{
        signedIn,
        save: (input) => {
          saves.push(input);
          return bareThenable(undefined);
        },
      }}
    />
  );
  await act(async () => {
    await signedIn;
  });

  const notPrevented = fireEvent.click(view.getByRole("link", { name: czech }));

  expect(notPrevented).toBe(false);
  await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
  expect(saves).toEqual([{ locale: "cs-CZ" }]);
});
