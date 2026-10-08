import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form } from "@/shared/components/ui/form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import { ReservationCustomerFields } from "./reservation-customer-fields";

function Harness() {
  const form = useForm<{ email: string; name: string; phone: string }>({
    defaultValues: { email: "", name: "", phone: "" },
  });

  return (
    <Form {...form}>
      <form>
        <ReservationCustomerFields locale="en-US" />
      </form>
    </Form>
  );
}

describe("ReservationCustomerFields", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(cleanup);

  afterAll(() => {
    unregisterWorkspaceComponentTestEnv();
  });

  test("renders contact fields without a message input or textarea", () => {
    const view = render(<Harness />);

    expect(view.container.querySelector("textarea")).toBeNull();
    expect(view.container.querySelector('input[name="message"]')).toBeNull();

    expect(view.container.querySelector('input[name="email"]')).not.toBeNull();
    expect(view.container.querySelector('input[name="phone"]')).not.toBeNull();
    expect(view.container.querySelector('input[name="name"]')).not.toBeNull();
  });
});
