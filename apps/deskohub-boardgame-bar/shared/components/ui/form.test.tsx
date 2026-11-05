import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { type FieldErrors, useForm } from "react-hook-form";
import { Form, FormField, FormItem, FormMessage } from "./form";

type ContactValues = { name: string };

function NameMessage({
  errors,
  children,
}: {
  errors?: FieldErrors<ContactValues>;
  children?: ReactNode;
}) {
  const form = useForm<ContactValues>({
    defaultValues: { name: "" },
    errors,
  });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={() => (
          <FormItem>
            <FormMessage className="text-red-400">{children}</FormMessage>
          </FormItem>
        )}
      />
    </Form>
  );
}

const messageOf = (html: string) => {
  const match = /<p id="([^"]*)" class="([^"]*)">(.*)<\/p>/.exec(html);
  return (
    match && { id: match[1], classes: match[2]?.split(" "), body: match[3] }
  );
};

describe("FormMessage", () => {
  test("shows the field's error in place of its own content", () => {
    const message = messageOf(
      renderToStaticMarkup(
        <NameMessage
          errors={{ name: { type: "required", message: "Required" } }}
        >
          Hint
        </NameMessage>
      )
    );

    expect(message?.body).toBe("Required");
    expect(message?.id).toEndWith("-form-item-message");
    // The caller's text color replaces the default destructive one.
    expect(message?.classes).toContain("text-red-400");
    expect(message?.classes).not.toContain("text-destructive");
  });

  test("shows its own content while the field is valid", () => {
    const message = messageOf(
      renderToStaticMarkup(<NameMessage>Hint</NameMessage>)
    );

    expect(message?.body).toBe("Hint");
    expect(message?.id).toEndWith("-form-item-message");
  });

  test("renders nothing without an error or content", () => {
    const html = renderToStaticMarkup(<NameMessage />);

    expect(html).not.toContain("<p");
    expect(html).toBe('<div class="space-y-2"></div>');
  });
});
