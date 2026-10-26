import { afterAll, afterEach, beforeAll, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { LocalePreferenceSaving } from "@/features/account/switch-locale";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const switchLocale = mock(
  async (_locale: Locale, _localePreference: LocalePreferenceSaving) =>
    undefined
);
const updateLocalePreference = mock(async () => ({}));

mock.module("@/features/account/switch-locale", () => ({ switchLocale }));
mock.module("@/features/account/actions", () => ({ updateLocalePreference }));
mock.module("next/navigation", () => ({
  usePathname: () => "/en-US/account/profile",
  useSearchParams: () => new URLSearchParams("ref=menu"),
}));

beforeAll(() => {
  registerWorkspaceComponentTestEnv();
});

afterEach(() => {
  cleanup();
  switchLocale.mockClear();
  updateLocalePreference.mockClear();
});

afterAll(async () => {
  await unregisterWorkspaceComponentTestEnv();
});

test("the header switcher and the profile language control switch through the same client path", async () => {
  const { LocaleSwitcherLinks } = await import(
    "@/shared/components/locale-switcher-links"
  );
  const { ProfileScreen } = await import(
    "@/features/account/components/profile/profile-screen"
  );
  // The header receives the same Server Action from its server config.
  const headerPreference = {
    signedIn: Promise.resolve(true),
    save: updateLocalePreference,
  };
  const view = render(
    <>
      <LocaleSwitcherLinks
        currentLocale="en-US"
        localePreference={headerPreference}
        languageLabels={{ "cs-CZ": "Czech", "en-US": "English" }}
      />
      <ProfileScreen
        email={testEmailAddress("ada")}
        firstName="Ada"
        lastName={null}
        locale="en-US"
      >
        {null}
      </ProfileScreen>
    </>
  );
  await act(() => headerPreference.signedIn);

  fireEvent.click(view.getByRole("link", { name: "Czech" }));

  await act(async () => {
    fireEvent.keyDown(
      view.getByRole("combobox", {
        name: m.accountProfileScreenLanguageLabel({}, { locale: "en-US" }),
      }),
      { key: "Enter" }
    );
  });
  const option = await view.findByRole("option", {
    name: m.accountProfileScreenLanguageOptionCs({}, { locale: "en-US" }),
  });
  await act(async () => {
    option.focus();
  });
  await act(async () => {
    fireEvent.keyDown(option, { key: "Enter" });
  });

  expect(switchLocale.mock.calls.map(([locale]) => locale)).toEqual([
    "cs-CZ",
    "cs-CZ",
  ]);
  const [[, header], [, profile]] = switchLocale.mock.calls as [
    [Locale, LocalePreferenceSaving],
    [Locale, LocalePreferenceSaving],
  ];
  expect(header).toBe(headerPreference);
  // Both switches save through the one Server Action, and the profile's
  // customer is always signed in.
  expect(profile.save).toBe(updateLocalePreference);
  expect(await profile.signedIn).toBe(true);
  // Neither caller saves on its own; the shared path owns the save.
  expect(updateLocalePreference).not.toHaveBeenCalled();
});
