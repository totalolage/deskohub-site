import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

mock.module("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

const setWindowUrl = (url: string) => {
  (
    window as typeof window & {
      happyDOM: { setURL: (nextUrl: string) => void };
    }
  ).happyDOM.setURL(url);
};

describe("ContactForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    setWindowUrl("https://workspace.example.test/");
  });

  afterAll(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    unregisterWorkspaceComponentTestEnv();
  });

  test("prefills fields from provided initial values", async () => {
    const { ContactForm } = await import("./contact-form");
    const view = render(
      <ContactForm
        locale="en-US"
        initialValues={{
          name: "Ada Lovelace",
          email: "ada@example.com",
          phone: "+420777777777",
          message: "Please help with order reservation-status-page.",
        }}
      />
    );

    expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
      "Ada Lovelace"
    );
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "ada@example.com"
    );
    expect((view.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "+420777777777"
    );
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Please help with order reservation-status-page."
    );
  });

  test("prefills fields from URL query values", async () => {
    const { ContactForm } = await import("./contact-form");
    setWindowUrl(
      "https://workspace.example.test/contact?name=Grace%20Hopper&email=grace%40example.com&phone=%2B420123456789&message=Static%20prefill"
    );

    const view = render(<ContactForm locale="en-US" />);

    await waitFor(() => {
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Grace Hopper"
      );
    });
    expect((view.getByLabelText("Email") as HTMLInputElement).value).toBe(
      "grace@example.com"
    );
    expect((view.getByLabelText("Phone") as HTMLInputElement).value).toBe(
      "+420123456789"
    );
    expect((view.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "Static prefill"
    );
  });

  test("updates URL query prefill after same-page navigation", async () => {
    const { ContactForm } = await import("./contact-form");
    setWindowUrl("https://workspace.example.test/contact?name=Ada");

    const view = render(<ContactForm locale="en-US" />);

    await waitFor(() => {
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Ada"
      );
    });

    setWindowUrl("https://workspace.example.test/contact?name=Grace");
    view.rerender(<ContactForm locale="en-US" />);

    await waitFor(() => {
      expect((view.getByLabelText("Name") as HTMLInputElement).value).toBe(
        "Grace"
      );
    });
  });
});
