import { afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
import { setBoardgameTestEnv } from "@/shared/testing/boardgame-test-env";
import { findElementsOfType } from "@/shared/testing/react-element-tree";
import { siteConstants } from "@/shared/utils/constants";

setBoardgameTestEnv();
mock.module("server-only", () => ({}));

let ContactForm: typeof import("@/features/contact").ContactForm;
let ContactInfo: typeof import("@/features/contact").ContactInfo;
let ContactPage: typeof import("./page").default;

beforeAll(async () => {
  ({ ContactForm, ContactInfo } = await import("@/features/contact"));
  ({ default: ContactPage } = await import("./page"));
});

const initialContactForm = siteConstants.featureFlags.contactForm;

afterEach(() => {
  siteConstants.featureFlags.contactForm = initialContactForm;
});

const renderPage = (searchParams: Record<string, string | string[]>) =>
  ContactPage({
    params: Promise.resolve({ locale: "cs-CZ" }),
    searchParams: Promise.resolve(searchParams),
  });

describe("ContactPage", () => {
  test("prefills the contact form from the query, capped to each field's length", async () => {
    siteConstants.featureFlags.contactForm = true;

    const page = await renderPage({
      name: "N".repeat(150),
      email: "jana@example.test",
      phone: "1".repeat(30),
      message: "M".repeat(1200),
    });

    expect(findElementsOfType(page, ContactInfo)).toHaveLength(1);
    expect(
      findElementsOfType(page, ContactForm).map(
        (form) => form.props.initialValues
      )
    ).toEqual([
      {
        name: "N".repeat(100),
        email: "jana@example.test",
        phone: "1".repeat(20),
        message: "M".repeat(1000),
      },
    ]);
  });

  test("leaves fields without a query value empty", async () => {
    siteConstants.featureFlags.contactForm = true;

    const [form] = findElementsOfType(await renderPage({}), ContactForm);

    expect(form?.props.initialValues).toEqual({
      name: "",
      email: "",
      phone: "",
      message: "",
    });
  });

  test("shows only the contact details while the contact form is disabled", async () => {
    siteConstants.featureFlags.contactForm = false;

    const page = await renderPage({ name: "Jana" });

    expect(findElementsOfType(page, ContactInfo)).toHaveLength(1);
    expect(findElementsOfType(page, ContactForm)).toEqual([]);
  });
});
