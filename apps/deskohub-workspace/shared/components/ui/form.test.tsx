import { afterAll, afterEach, expect, test } from "bun:test";
import { act, cleanup, render } from "@testing-library/react";
import { type UseFormReturn, useForm } from "react-hook-form";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

registerWorkspaceComponentTestEnv();

const { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } =
  await import("./form");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

type Values = { readonly email: string };

function EmailForm({
  onForm,
}: {
  readonly onForm: (form: UseFormReturn<Values>) => void;
}) {
  const form = useForm<Values>({ defaultValues: { email: "" } });
  onForm(form);
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="email"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Email</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
            <FormMessage data-testid="message" />
          </FormItem>
        )}
      />
    </Form>
  );
}

test("keeps the empty live region mounted and fills it when an error is set", () => {
  let form: UseFormReturn<Values> | undefined;
  const view = render(
    <EmailForm
      onForm={(current) => {
        form = current;
      }}
    />
  );

  const message = view.getByTestId("message");
  expect(message.getAttribute("aria-live")).toBe("polite");
  expect(message.textContent).toBe("");
  const input = view.getByRole("textbox", { name: "Email" });
  expect(input.getAttribute("aria-invalid")).toBe("false");

  act(() => {
    form?.setError("email", { message: "Enter a valid email." });
  });

  expect(view.getByTestId("message")).toBe(message);
  expect(message.textContent).toBe("Enter a valid email.");
  expect(input.getAttribute("aria-invalid")).toBe("true");
  expect(input.getAttribute("aria-describedby")).toBe(message.id);

  act(() => {
    form?.clearErrors("email");
  });

  expect(view.getByTestId("message")).toBe(message);
  expect(message.textContent).toBe("");
});
