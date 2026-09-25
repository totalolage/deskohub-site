import { describe, expect, mock, test } from "bun:test";
import {
  createElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";

mock.module("next/font/local", () => ({
  default: () => ({ variable: "--font-sculpin" }),
}));
mock.module("@next/third-parties/google", () => ({
  GoogleTagManager: () => null,
}));
mock.module("@/env", () => ({
  env: { NEXT_PUBLIC_GTM_ID: undefined },
}));
mock.module(
  "@/features/cookie-consent/components/consent-aware-analytics",
  () => ({ ConsentAwareAnalytics: () => null })
);
mock.module(
  "@/features/cookie-consent/components/cookie-consent-provider",
  () => ({ CookieConsentProvider: () => null })
);
mock.module("@/features/cookie-consent/components/posthog-analytics", () => ({
  PostHogProvider: ({ children }: { children: ReactNode }) => children,
}));
mock.module("@/shared/components/unsaved-changes-guard", () => ({
  UnsavedChangesProvider: ({ children }: { children: ReactNode }) =>
    createElement("unsaved-changes-guard", null, children),
}));

const page = createElement("page");

describe("localized route layout", () => {
  test("renders children without owning an account reservation modal slot", async () => {
    const { default: LocaleLayout } = await import("./layout");
    const tree = (await LocaleLayout({
      children: page,
      params: Promise.resolve({ locale: "en-US" }),
    })) as ReactElement<{ children: ReactNode; lang?: string }>;

    expect(tree.type).toBe("html");
    expect(tree.props.lang).toBe("en-US");

    let ownsModalSlot = false;
    let rendersChildren = false;
    const visit = (node: ReactNode): void => {
      if (isValidElement(node)) {
        const element = node as ReactElement<{ children?: ReactNode }>;
        if ("modal" in element.props) ownsModalSlot = true;
        if (element.props.children === page) rendersChildren = true;
        visit(element.props.children);
        return;
      }
      if (Array.isArray(node)) node.forEach(visit);
    };
    visit(tree);

    expect(ownsModalSlot).toBe(false);
    expect(rendersChildren).toBe(true);
  });

  test("rejects an unknown locale", async () => {
    const { default: LocaleLayout } = await import("./layout");
    await expect(
      LocaleLayout({
        children: page,
        params: Promise.resolve({ locale: "xx-XX" }),
      })
    ).rejects.toThrow();
  });
});
