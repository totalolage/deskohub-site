import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ContactForm } from "./contact-form";

describe("ContactForm", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
  });

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("prefills fields from provided initial values", () => {
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
});
