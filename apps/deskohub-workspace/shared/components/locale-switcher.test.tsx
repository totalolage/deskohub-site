import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import {
  act,
  cleanup,
  fireEvent,
  type RenderResult,
  render,
  waitFor,
  within,
} from "@testing-library/react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import type { Locale } from "@/features/i18n";
import {
  languageNameStyle,
  languageNames,
} from "@/features/i18n/language-labels";
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

const czech = languageNames["cs-CZ"];
const triggerLabel = "Language menu";
const linksLabel = "Languages";

// Czech first, then English, then the rest in registry order (decision D23).
const displayOrder: readonly Locale[] = [
  "cs-CZ",
  "en-US",
  "de-DE",
  "uk-UA",
  "sk-SK",
  "vi-VN",
  "hi-IN",
];

const localePreference = (signedIn: boolean) => {
  const saves: { locale: string }[] = [];
  const saved = Promise.withResolvers<void>();
  return {
    saves,
    saved,
    preference: {
      signedIn: Promise.resolve(signedIn),
      save: (input: { locale: Locale }) => {
        saves.push(input);
        return saved.promise;
      },
    },
  };
};

// Radix opens the menu on a primary-button pointerdown on its trigger.
const openLanguageMenu = async (view: RenderResult) => {
  await act(async () => {
    fireEvent.pointerDown(view.getByRole("button", { name: triggerLabel }), {
      button: 0,
      ctrlKey: false,
      pointerType: "mouse",
    });
  });
  return view.findByRole("menu");
};

// Lets queued promise callbacks and timers run, so a test can assert that
// nothing happened yet rather than that it had not happened so far.
const flushPendingWork = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

type Surface = {
  readonly name: string;
  /** Renders the switcher and returns the control that switches to Czech. */
  readonly renderCzechChoice: (
    localePreference?: LocalePreferenceSaving
  ) => Promise<{ readonly view: RenderResult; readonly czech: HTMLElement }>;
};

// The header menu and the footer links share one switching path; each click
// behaviour holds for both.
const surfaces: readonly Surface[] = [
  {
    name: "language menu item",
    renderCzechChoice: async (preference) => {
      const { LanguageMenu } = await import("./locale-switcher");
      const view = render(
        <LanguageMenu
          locale="en-US"
          triggerLabel={triggerLabel}
          tone="light"
          localePreference={preference}
        />
      );
      const menu = await openLanguageMenu(view);
      return {
        view,
        czech: within(menu).getByRole("menuitem", { name: czech }),
      };
    },
  },
  {
    name: "language link",
    renderCzechChoice: async (preference) => {
      const { LanguageLinks } = await import("./locale-switcher");
      // A settled session check updates the links right after the render.
      const view = await act(async () =>
        render(
          <LanguageLinks
            locale="en-US"
            label={linksLabel}
            localePreference={preference}
          />
        )
      );
      return { view, czech: view.getByRole("link", { name: czech }) };
    },
  },
];

describe("LanguageMenu", () => {
  test("the prerendered shell shows the trigger alone until the query can be read", async () => {
    const { LanguageMenu } = await import("./locale-switcher");
    pendingSearch = new Promise<never>(() => undefined);

    const shell = render(
      <LanguageMenu locale="en-US" triggerLabel={triggerLabel} tone="inverse" />
    );

    expect(shell.container.querySelector("a")).toBeNull();
    expect(shell.container.querySelector("[data-locale-switcher]")).toBeNull();
    const trigger = shell.getByRole("button", { name: triggerLabel });
    expect(trigger.hasAttribute("data-language-menu-trigger")).toBe(true);
    expect(trigger.querySelector("[lang]")?.getAttribute("lang")).toBe("en-US");
  });

  test("renders no language items until the menu is opened", async () => {
    const { LanguageMenu } = await import("./locale-switcher");

    const view = render(
      <LanguageMenu locale="en-US" triggerLabel={triggerLabel} tone="light" />
    );

    const menuContent = () =>
      view.baseElement.querySelector("[data-locale-switcher]");
    expect(menuContent()).toBeNull();
    expect(view.baseElement.querySelector("a")).toBeNull();
    expect(
      view
        .getByRole("button", { name: triggerLabel })
        .getAttribute("aria-expanded")
    ).toBe("false");

    const menu = await openLanguageMenu(view);
    expect(menuContent()).toBe(menu);
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(
      displayOrder.length
    );

    await act(async () => {
      fireEvent.keyDown(menu, { key: "Escape" });
    });
    expect(menuContent()).toBeNull();
    expect(view.baseElement.querySelector("a")).toBeNull();
  });

  test("lists every language in its own language in display order, marking the current one without a link", async () => {
    const { LanguageMenu } = await import("./locale-switcher");
    currentPathname = "/cs-CZ";

    const view = render(
      <LanguageMenu locale="cs-CZ" triggerLabel={triggerLabel} tone="light" />
    );
    const menu = await openLanguageMenu(view);

    expect(menu.hasAttribute("data-locale-switcher")).toBe(true);
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual(
      displayOrder.map((locale) => languageNames[locale])
    );
    for (const [index, item] of items.entries()) {
      const locale = displayOrder[index] as Locale;
      expect(item.querySelector("[lang]")?.getAttribute("lang")).toBe(locale);
      if (locale === "cs-CZ") {
        expect(item.getAttribute("aria-current")).toBe("true");
        expect(item.tagName).not.toBe("A");
        expect(item.hasAttribute("href")).toBe(false);
      } else {
        expect(item.hasAttribute("aria-current")).toBe(false);
        expect(item.tagName).toBe("A");
        expect(item.getAttribute("href")).toBe(`/${locale}`);
        expect(item.getAttribute("hrefLang")).toBe(locale);
      }
    }
  });

  test("sets each language's name in that language's name face", async () => {
    const { LanguageMenu } = await import("./locale-switcher");
    currentPathname = "/cs-CZ";

    const view = render(
      <LanguageMenu locale="cs-CZ" triggerLabel={triggerLabel} tone="light" />
    );
    const menu = await openLanguageMenu(view);

    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item) => {
          const name = item.querySelector<HTMLElement>("[lang]");
          return [name?.lang, name?.style.fontFamily];
        })
    ).toEqual(
      displayOrder.map((locale) => [
        locale,
        languageNameStyle(locale)?.fontFamily ?? "",
      ])
    );
  });

  test("links each other language to the current page with its query", async () => {
    const { LanguageMenu } = await import("./locale-switcher");
    currentPathname = "/en-US/pricing";
    currentSearch = "ref=menu";

    const view = render(
      <LanguageMenu locale="en-US" triggerLabel={triggerLabel} tone="light" />
    );
    const menu = await openLanguageMenu(view);

    expect(
      within(menu).getByRole("menuitem", { name: czech }).getAttribute("href")
    ).toBe("/cs-CZ/pricing?ref=menu");
  });

  test("a signed-in switch closes the menu while the preference saves", async () => {
    const { LanguageMenu } = await import("./locale-switcher");
    const { saves, preference } = localePreference(true);
    const view = render(
      <LanguageMenu
        locale="en-US"
        triggerLabel={triggerLabel}
        tone="light"
        localePreference={preference}
      />
    );
    const menu = await openLanguageMenu(view);
    await act(() => preference.signedIn);

    fireEvent.click(within(menu).getByRole("menuitem", { name: czech }));

    await waitFor(() => expect(view.queryByRole("menu")).toBeNull());
    expect(saves).toEqual([{ locale: "cs-CZ" }]);
    expect(window.location.pathname).toBe("/en-US");
  });
});

describe("LanguageLinks", () => {
  test("the prerendered shell shows the names without links until the query can be read", async () => {
    const { LanguageLinks } = await import("./locale-switcher");
    pendingSearch = new Promise<never>(() => undefined);

    const shell = render(<LanguageLinks locale="en-US" label={linksLabel} />);
    const shellItems = itemSummaries(shell);
    shell.unmount();
    pendingSearch = undefined;
    const ready = render(<LanguageLinks locale="en-US" label={linksLabel} />);

    expect(shellItems.map(([tagName]) => tagName)).toEqual(
      displayOrder.map(() => "SPAN")
    );
    // The shell keeps the client's list: the same names, languages and current
    // marker, with plain text where the client renders links.
    expect(shellItems.map(([, ...rest]) => rest)).toEqual(
      itemSummaries(ready).map(([, ...rest]) => rest)
    );
    expect(ready.getAllByRole("link")).toHaveLength(displayOrder.length - 1);
  });

  test("lists every language in its own language in display order, marking the current one without a link", async () => {
    const { LanguageLinks } = await import("./locale-switcher");
    currentPathname = "/cs-CZ";

    const view = render(<LanguageLinks locale="cs-CZ" label={linksLabel} />);

    const navigation = view.getByRole("navigation", { name: linksLabel });
    expect(
      within(navigation)
        .getAllByRole("listitem")
        .map((item) => item.textContent)
    ).toEqual(displayOrder.map((locale) => languageNames[locale]));
    expect(view.queryByRole("link", { name: czech })).toBeNull();
    const current = within(navigation).getByText(czech);
    expect(current.getAttribute("aria-current")).toBe("true");
    expect(current.getAttribute("lang")).toBe("cs-CZ");
    for (const locale of displayOrder.filter((l) => l !== "cs-CZ")) {
      const link = view.getByRole("link", { name: languageNames[locale] });
      expect(link.getAttribute("href")).toBe(`/${locale}`);
      expect(link.getAttribute("hrefLang")).toBe(locale);
      expect(link.getAttribute("lang")).toBe(locale);
    }
  });

  test("sets each language's name in that language's name face", async () => {
    const { LanguageLinks } = await import("./locale-switcher");
    currentPathname = "/cs-CZ";

    const view = render(<LanguageLinks locale="cs-CZ" label={linksLabel} />);

    expect(
      within(view.getByRole("navigation", { name: linksLabel }))
        .getAllByRole("listitem")
        .map((item) => {
          const name = item.querySelector<HTMLElement>("[lang]");
          return [name?.lang, name?.style.fontFamily];
        })
    ).toEqual(
      displayOrder.map((locale) => [
        locale,
        languageNameStyle(locale)?.fontFamily ?? "",
      ])
    );
  });

  test("links each other language to the current page with its query", async () => {
    const { LanguageLinks } = await import("./locale-switcher");
    currentPathname = "/en-US/pricing";
    currentSearch = "ref=menu";

    const view = render(<LanguageLinks locale="en-US" label={linksLabel} />);

    expect(view.getByRole("link", { name: czech }).getAttribute("href")).toBe(
      "/cs-CZ/pricing?ref=menu"
    );
  });
});

// Each list item as its rendered tag, language, name and current marker.
const itemSummaries = (view: RenderResult) =>
  view.getAllByRole("listitem").map((item) => {
    const label = item.firstElementChild;
    return [
      label?.tagName,
      label?.getAttribute("lang"),
      label?.textContent,
      label?.getAttribute("aria-current"),
    ];
  });

// React hands a client component the server's streamed promise as a bare
// thenable: it has `then` and nothing else, so `catch` and `finally` are absent.
const bareThenable = <T,>(value: T): PromiseLike<T> => ({
  // biome-ignore lint/suspicious/noThenProperty: models React's streamed thenable.
  then: (onFulfilled, onRejected) =>
    Promise.resolve(value).then(onFulfilled, onRejected),
});

describe.each(surfaces)("switching from a $name", (surface) => {
  test("a signed-in switch saves the preference before navigating to the new locale", async () => {
    const { saves, saved, preference } = localePreference(true);
    const { czech: choice } = await surface.renderCzechChoice(preference);
    await act(() => preference.signedIn);

    fireEvent.click(choice);

    await waitFor(() => expect(saves).toEqual([{ locale: "cs-CZ" }]));
    expect(window.location.pathname).toBe("/en-US");

    await act(async () => {
      saved.resolve();
      await saved.promise;
    });

    expect(window.location.pathname).toBe("/cs-CZ");
  });

  test("a signed-in modified click opens the link natively without saving", async () => {
    const { saves, preference } = localePreference(true);
    const { czech: choice } = await surface.renderCzechChoice(preference);
    await act(() => preference.signedIn);

    const notPrevented = fireEvent.click(choice, { ctrlKey: true });
    await flushPendingWork();

    // The browser follows the unprevented link itself, here and for real.
    expect(notPrevented).toBe(true);
    expect(saves).toEqual([]);
  });

  test("a signed-in switch still navigates when the save fails", async () => {
    const saves: { locale: string }[] = [];
    const signedIn = Promise.resolve(true);
    const { czech: choice } = await surface.renderCzechChoice({
      signedIn,
      save: (input) => {
        saves.push(input);
        return Promise.reject(new Error("network unreachable"));
      },
    });
    await act(() => signedIn);

    fireEvent.click(choice);

    await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
    expect(saves).toEqual([{ locale: "cs-CZ" }]);
  });

  test("a guest switch stays a plain link without saving", async () => {
    const { saves, preference } = localePreference(false);
    const { czech: choice } = await surface.renderCzechChoice(preference);
    await act(() => preference.signedIn);

    const notPrevented = fireEvent.click(choice);

    expect(notPrevented).toBe(true);
    expect(choice.getAttribute("href")).toBe("/cs-CZ");
    expect(saves).toEqual([]);
  });

  test("a switch before the session check settles waits for it, then saves when signed in", async () => {
    const signedIn = Promise.withResolvers<boolean>();
    const saves: { locale: string }[] = [];
    const { czech: choice } = await surface.renderCzechChoice({
      signedIn: signedIn.promise,
      save: (input) => {
        saves.push(input);
        return Promise.resolve();
      },
    });

    const notPrevented = fireEvent.click(choice);
    await flushPendingWork();
    expect(notPrevented).toBe(false);
    expect(saves).toEqual([]);
    expect(window.location.pathname).toBe("/en-US");

    await act(async () => {
      signedIn.resolve(true);
      await signedIn.promise;
    });

    await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
    expect(saves).toEqual([{ locale: "cs-CZ" }]);
  });

  test("a guest switch before the session check settles navigates without saving", async () => {
    const signedIn = Promise.withResolvers<boolean>();
    const saves: { locale: string }[] = [];
    const { czech: choice } = await surface.renderCzechChoice({
      signedIn: signedIn.promise,
      save: (input) => {
        saves.push(input);
        return Promise.resolve();
      },
    });

    const notPrevented = fireEvent.click(choice);
    await flushPendingWork();
    expect(notPrevented).toBe(false);
    expect(window.location.pathname).toBe("/en-US");
    await act(async () => {
      signedIn.resolve(false);
      await signedIn.promise;
    });

    await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
    expect(saves).toEqual([]);
  });

  test("a signed-in switch with a streamed bare thenable saves, then navigates", async () => {
    const saves: { locale: string }[] = [];
    const signedIn = bareThenable(true);
    const { czech: choice } = await surface.renderCzechChoice({
      signedIn,
      save: (input) => {
        saves.push(input);
        return bareThenable(undefined);
      },
    });
    await act(async () => {
      await signedIn;
    });

    const notPrevented = fireEvent.click(choice);

    expect(notPrevented).toBe(false);
    await waitFor(() => expect(window.location.pathname).toBe("/cs-CZ"));
    expect(saves).toEqual([{ locale: "cs-CZ" }]);
  });
});
