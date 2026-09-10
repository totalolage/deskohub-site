import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Input } from "@/shared/components/ui/input";
import type { ProfileScreenCopy, ProfileScreenProps } from "./profile-screen";
import { ProfileScreen } from "./profile-screen";

const englishCopy: ProfileScreenCopy = {
  avatarUnavailableDescription: "Profile photos are not available here.",
  avatarUnavailableLabel: "Profile photo unavailable",
  emailLabel: "Email address",
  languageLabel: "Preferred communication language",
  languageUnavailableDescription: "Language preferences are not saved yet.",
  languageUnavailableValue: "Not set",
  memberFallback: "Workspace member",
  title: "Member profile and settings",
  verifiedEmail: "Verified login email",
};

const profileFields = (
  <>
    <div>
      <label htmlFor="profile-first-name">First name</label>
      <Input
        id="profile-first-name"
        name="firstName"
        required
        type="text"
        variant="error"
      />
    </div>
    <div>
      <label htmlFor="profile-last-name">Last name</label>
      <Input id="profile-last-name" name="lastName" type="text" />
    </div>
    <div>
      <label htmlFor="profile-phone">Phone</label>
      <Input id="profile-phone" name="phone" type="tel" />
    </div>
  </>
);

function extractLiteralColor(
  markup: string,
  utility: "bg" | "text",
  context: RegExp
): string {
  const fragment = markup.match(context)?.[0];
  const color = fragment?.match(
    new RegExp(`${utility}-\\[#([0-9a-f]{6})\\]`)
  )?.[1];
  if (!color) {
    throw new Error(`Could not find ${utility} color in rendered markup`);
  }
  return `#${color}`;
}

function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string) => {
    const channels = [0, 2, 4].map(
      (offset) => Number.parseInt(hex.slice(offset + 1, offset + 3), 16) / 255
    );
    const linearChannels = channels.map((channel) =>
      channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    );
    return (
      linearChannels[0]! * 0.2126 +
      linearChannels[1]! * 0.7152 +
      linearChannels[2]! * 0.0722
    );
  };

  const foregroundLuminance = luminance(foreground);
  const backgroundLuminance = luminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function renderProfile(overrides: Partial<ProfileScreenProps> = {}): string {
  return renderToStaticMarkup(
    <ProfileScreen
      {...overrides}
      copy={overrides.copy ?? englishCopy}
      email={overrides.email ?? "ada@example.test"}
      firstName={overrides.firstName ?? "Ada"}
      lastName={
        "lastName" in overrides ? (overrides.lastName ?? null) : "Lovelace"
      }
      footer={overrides.footer ?? <button type="button">Save profile</button>}
    >
      {overrides.children ?? profileFields}
    </ProfileScreen>
  );
}

describe("ProfileScreen", () => {
  test("renders the caller fields and footer without owning a form", () => {
    const markup = renderProfile();

    expect(markup).toContain('data-slot="profile-screen"');
    expect(markup).toContain("Member profile and settings");
    expect(markup).toContain("Ada Lovelace");
    expect(markup).toContain("Save profile");
    expect(markup).not.toMatch(/<form\b/);

    const namedControls = [...markup.matchAll(/\bname="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(namedControls).toEqual(["firstName", "lastName", "phone"]);
    expect(markup).not.toMatch(/name="(?:email|language)"/);
  });

  test("keeps the login email visual, verified, and non-editable", () => {
    const markup = renderProfile();

    expect(markup).toContain("ada@example.test");
    expect(markup).toContain("break-all");
    expect(markup).toContain("Verified login email");
    expect(markup).toContain("<fieldset");
    const emailFieldset = markup.match(
      /<legend[^>]*id="[^"]+-email-label">Email address<\/legend>/
    );
    expect(emailFieldset).toBeTruthy();
    expect(markup).not.toContain(
      "This verified address cannot be changed here."
    );
    expect(markup).not.toMatch(/id="[^"]+-email-description"/);
    const emailFieldsetElement = markup.match(
      /<fieldset[^>]*aria-labelledby="[^"]+-email-label"[^>]*>/
    )?.[0];
    expect(emailFieldsetElement).toBeDefined();
    expect(emailFieldsetElement).not.toContain("aria-describedby");
    expect(markup).not.toMatch(/<span[^>]*aria-label="Verified login email"/);
    expect(markup).not.toMatch(/name="email"/);
    expect(markup).not.toMatch(/<input[^>]*ada@example\.test/);
  });

  test("retains shared Input error state and only scopes local sizing", () => {
    const markup = renderProfile();
    const errorInput = markup.match(/<input\b[^>]*name="firstName"[^>]*>/)?.[0];
    const gridClass = markup
      .match(/<div class="([^"]*sm:grid-cols-2[^"]*)">/)?.[1]
      ?.replaceAll("&amp;", "&");

    expect(errorInput).toContain("border-burned-orange");
    expect(gridClass).toBeDefined();
    expect(gridClass).not.toContain("[&_input]:border-[#cad3df]");
    expect(gridClass).not.toContain("[&_[data-slot=input]]:border-[#cad3df]");
  });

  test("emits responsive wrapping constraints for a long Czech email status", () => {
    const longCzechVerifiedEmail =
      "Ověřený přihlašovací e-mail pro rezervace a zákaznický účet Workspace";
    const longCzechEmail =
      "jan.novak.velmi.dlouhy.alias@example.workspace.deskohub.cz";
    const markup = renderProfile({
      copy: { ...englishCopy, verifiedEmail: longCzechVerifiedEmail },
      email: longCzechEmail,
    });
    const emailFieldsetClass = markup.match(
      /<fieldset[^>]*class="([^"]*)"/
    )?.[1];
    const verificationStatusClass = markup.match(
      /<span class="([^"]*inline-flex min-w-0 max-w-full[^"]*text-\[#006b50\][^"]*)">/
    )?.[1];
    const verificationStatus = markup.match(
      /<span class="[^"]*inline-flex min-w-0 max-w-full[^"]*text-\[#006b50\][^"]*">[\s\S]*?<\/span><\/div>/
    )?.[0];

    expect(markup).toContain(longCzechEmail);
    expect(markup).toContain(longCzechVerifiedEmail);
    expect(emailFieldsetClass).toContain("min-w-0");
    expect(emailFieldsetClass).toContain("sm:col-span-2");
    expect(emailFieldsetClass).toContain("lg:col-span-1");
    expect(verificationStatusClass).toContain("inline-flex");
    expect(verificationStatusClass).toContain("min-w-0");
    expect(verificationStatusClass).toContain("max-w-full");
    expect(verificationStatusClass).not.toContain("shrink-0");
    expect(verificationStatus).toMatch(/class="[^"]*size-4 shrink-0[^"]*"/);
    expect(verificationStatus).toContain(
      'class="min-w-0 flex-1 break-words whitespace-normal"'
    );
  });

  test("disables unavailable camera and language controls without a preference", () => {
    const markup = renderProfile();
    const disabledButtons = markup.match(/<button\b[^>]*disabled/g) ?? [];
    const options = markup.match(/<option\b/g) ?? [];

    expect(disabledButtons).toHaveLength(1);
    expect(markup).toContain('aria-label="Profile photo unavailable"');
    expect(markup).toMatch(/<select\b[^>]*disabled/);
    expect(markup).not.toMatch(/<select\b[^>]*name=/);
    expect(options).toHaveLength(1);
    expect(markup).toContain('<option value="">Not set</option>');
    expect(markup).toContain("Language preferences are not saved yet.");
    expect(markup).not.toContain("Czech");
  });

  test("keeps informational and verification text above the contrast floor", () => {
    const markup = renderProfile();
    const sectionClass = markup.match(/<section[^>]*class="([^"]*)"/)?.[1];
    const informationalText = extractLiteralColor(
      markup,
      "text",
      /<p class="[^"]*"[^>]*>Profile photos are not available here\.<\/p>/
    );
    const emailBackground = extractLiteralColor(
      markup,
      "bg",
      /<div class="[^"]*bg-\[#f8fafc\][^"]*">/
    );
    const verificationSpan =
      /<span class="[^"]*inline-flex min-w-0 max-w-full[^"]*text-sm font-semibold text-\[#(?:[0-9a-f]{6})\][^"]*">/;
    const verificationText = extractLiteralColor(
      markup,
      "text",
      verificationSpan
    );
    const languageSelect = /<select[^>]*bg-\[#f8fafc\][^>]*>/;
    const languageText = extractLiteralColor(markup, "text", languageSelect);
    const languageBackground = extractLiteralColor(
      markup,
      "bg",
      languageSelect
    );

    expect(sectionClass).toContain("bg-white");
    expect(emailBackground).toBe("#f8fafc");
    expect(verificationText).toBe("#006b50");
    expect(contrastRatio(informationalText, "#ffffff")).toBeGreaterThanOrEqual(
      4.5
    );
    expect(
      contrastRatio(verificationText, emailBackground)
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrastRatio(languageText, languageBackground)
    ).toBeGreaterThanOrEqual(4.5);

    const mutatedMarkup = markup.replace("text-[#006b50]", "text-[#008965]");
    expect(mutatedMarkup).not.toBe(markup);
    const mutatedVerificationText = extractLiteralColor(
      mutatedMarkup,
      "text",
      verificationSpan
    );
    expect(() =>
      expect(
        contrastRatio(mutatedVerificationText, emailBackground)
      ).toBeGreaterThanOrEqual(4.5)
    ).toThrow();
  });

  test("uses real Unicode code points and a neutral icon when names are absent", () => {
    const unicodeMarkup = renderProfile({
      firstName: "  𐐀da",
      lastName: "😀ski  ",
    });
    expect(unicodeMarkup).toContain("𐐀da 😀ski");
    expect(unicodeMarkup).toContain("𐐀😀");
    expect(unicodeMarkup).not.toContain("�");

    const fallbackMarkup = renderProfile({ firstName: "  ", lastName: null });
    expect(fallbackMarkup).toContain("Workspace member");
    expect(fallbackMarkup).toContain("lucide-user-round");
    expect(fallbackMarkup).not.toContain(">WM<");
  });

  test("renders injected localized copy without inventing membership claims", () => {
    const localizedCopy: ProfileScreenCopy = {
      avatarUnavailableDescription: "Profilové fotografie nejsou k dispozici.",
      avatarUnavailableLabel: "Profilová fotografie není k dispozici",
      emailLabel: "E-mailová adresa",
      languageLabel: "Preferovaný komunikační jazyk",
      languageUnavailableDescription: "Preference jazyka se zatím neukládají.",
      languageUnavailableValue: "Nenastaveno",
      memberFallback: "Člen Workspace",
      title: "Profil a nastavení",
      verifiedEmail: "Ověřený přihlašovací e-mail",
    };
    const markup = renderProfile({
      copy: localizedCopy,
      firstName: "",
      lastName: null,
    });

    for (const copyValue of Object.values(localizedCopy)) {
      expect(markup).toContain(copyValue);
    }
    expect(markup).not.toMatch(/member since|Prague|Czechia|turnstile|access/i);
  });
});
