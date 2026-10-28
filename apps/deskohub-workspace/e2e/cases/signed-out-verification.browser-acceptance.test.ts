import { afterAll, beforeAll, expect, test } from "bun:test";
import { type Browser, chromium, type Page } from "@playwright/test";
import { playwrightChromiumAvailable } from "@/shared/testing/playwright-browser";
import { isSignedOutContactStep } from "./signed-out-verification";

const chromiumAvailable = await playwrightChromiumAvailable();
const origin = "https://workspace.example.test";
let browser: Browser | undefined;
let page: Page | undefined;

beforeAll(async () => {
  if (!chromiumAvailable) return;
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
  // The prompt link resolves against the page's origin.
  await page.route(`${origin}/**`, (route) =>
    route.fulfill({ body: "<html></html>", contentType: "text/html" })
  );
});

afterAll(async () => {
  await browser?.close();
});

const prompt = {
  signInLabel: "Sign in",
  signInPathname: "/en-US/auth/sign-in",
  submitSelector: "#reservation-submit",
  text: "Booked before? Sign in to fill in your details.",
};

const contactStep = ({
  field = (name: string) => `<input name="${name}" />`,
  promptHtml = `<p>Booked before?
    <a href="/en-US/auth/sign-in">Sign  in</a> to fill in your details.</p>`,
  submit = '<button id="reservation-submit">Book</button>',
} = {}) => `
  ${promptHtml}
  <form>
    ${field("name")}${field("email")}${field("phone")}
    ${submit}
  </form>`;

const isSignedOutOn = async (html: string) => {
  if (!page) throw new Error("Chromium is not running");
  await page.goto(`${origin}/en-US/reservation/cowork`);
  await page.setContent(html);
  return page.evaluate(isSignedOutContactStep, prompt);
};

test.skipIf(!chromiumAvailable)(
  "accepts an editable contact step with the sign-in prompt and its link",
  async () => {
    expect(await isSignedOutOn(contactStep())).toBe(true);
  }
);

test.skipIf(!chromiumAvailable)(
  "rejects a contact step that is read-only, unformed or missing the prompt link",
  async () => {
    const rejected = [
      contactStep({
        field: (name) =>
          name === "email"
            ? `<input name="${name}" readonly />`
            : `<input name="${name}" />`,
      }),
      contactStep({
        field: (name) =>
          name === "phone"
            ? `<input name="${name}" disabled />`
            : `<input name="${name}" />`,
      }),
      contactStep({
        field: (name) => (name === "name" ? "" : `<input name="${name}" />`),
      }),
      `${contactStep({ submit: "" })}<button id="reservation-submit">Book</button>`,
      contactStep({
        promptHtml: "<p>Booked before? Sign in to fill in your details.</p>",
      }),
      contactStep({
        promptHtml: `<p>Booked before? <a href="/en-US/account">Sign in</a> to fill in your details.</p>`,
      }),
      contactStep({
        promptHtml: `<p>Booked before? <a href="/en-US/auth/sign-in">Log in</a> to fill in your details.</p>`,
      }),
    ];
    for (const html of rejected) {
      expect(await isSignedOutOn(html)).toBe(false);
    }
  }
);
