import { afterAll, afterEach, expect, test } from "bun:test";
import { cleanup, fireEvent, render } from "@testing-library/react";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { ButtonProps } from "./button";

registerWorkspaceComponentTestEnv();

const { Button, buttonVariants } = await import("./button");

afterEach(cleanup);
afterAll(unregisterWorkspaceComponentTestEnv);

const classesOf = (element: HTMLElement) => element.className.split(" ");

test("defaults to a raised burned-orange pill whose glow follows the fill", () => {
  const view = render(<Button>Reserve</Button>);
  const classes = classesOf(view.getByRole("button", { name: "Reserve" }));

  expect(classes).toEqual(
    expect.arrayContaining([
      "bg-burned-orange",
      "shadow-button-raised",
      "rounded-full",
      "h-11",
      "[--button-tint:var(--color-burned-orange)]",
    ])
  );
});

test.each([
  ["navy-blue", "bg-navy-blue", "[--button-tint:var(--color-navy-blue)]"],
  ["danger", "bg-red-800", "[--button-tint:var(--color-red-800)]"],
  [
    "chilean-fire",
    "bg-chilean-fire",
    "[--button-tint:var(--color-chilean-fire)]",
  ],
] as const)(
  "primary tone %s sets the fill and glow together",
  (tone, fill, tint) => {
    const view = render(<Button tone={tone}>Go</Button>);
    const classes = classesOf(view.getByRole("button"));

    expect(classes).toEqual(expect.arrayContaining([fill, tint]));
    expect(classes).not.toContain("bg-burned-orange");
  }
);

test("secondary and ghost tones replace the default text colour", () => {
  const view = render(
    <>
      <Button tone="burned-orange" variant="secondary">
        Secondary
      </Button>
      <Button tone="muted" variant="ghost">
        Ghost
      </Button>
    </>
  );
  const secondary = classesOf(view.getByRole("button", { name: "Secondary" }));
  const ghost = classesOf(view.getByRole("button", { name: "Ghost" }));

  expect(secondary).toEqual(
    expect.arrayContaining([
      "text-burned-orange",
      "shadow-button-raised-subtle",
    ])
  );
  expect(secondary).not.toContain("text-navy-blue");
  expect(ghost).toContain("text-navy-blue/60");
  expect(ghost).not.toContain("shadow-button-raised");
});

test("the secondary ink tone keeps a faint orange edge", () => {
  const view = render(
    <Button tone="burned-orange-ink" variant="secondary">
      Delete
    </Button>
  );
  const classes = classesOf(view.getByRole("button", { name: "Delete" }));

  expect(classes).toEqual(
    expect.arrayContaining([
      "border-burned-orange/25",
      "text-burned-orange-ink",
      "hover:border-burned-orange",
    ])
  );
  expect(classes).not.toContain("text-burned-orange");
});

test("ghost outline and tinted tones add an edge or a light fill", () => {
  const view = render(
    <>
      <Button size="xs" tone="outline" variant="ghost">
        Dismiss
      </Button>
      <Button size="icon-sm" tone="tinted" variant="ghost">
        Next
      </Button>
    </>
  );
  const outline = classesOf(view.getByRole("button", { name: "Dismiss" }));
  const tinted = classesOf(view.getByRole("button", { name: "Next" }));

  expect(outline).toEqual(
    expect.arrayContaining(["border", "border-navy-blue/14", "h-7", "py-1"])
  );
  expect(outline).not.toContain("shadow-button-raised-subtle");
  expect(tinted).toEqual(
    expect.arrayContaining(["bg-navy-blue/5", "hover:bg-burned-orange/10"])
  );
  expect(tinted).not.toContain("border");
});

test("shape, caps, wrap and fullWidth map to first-class classes", () => {
  const view = render(
    <Button caps fullWidth shape="rounded" size="xl" wrap>
      Pay
    </Button>
  );
  const classes = classesOf(view.getByRole("button"));

  expect(classes).toEqual(
    expect.arrayContaining([
      "rounded-xl",
      "uppercase",
      "tracking-[0.18em]",
      "w-full",
      "h-auto",
      "min-h-13",
      "whitespace-normal",
    ])
  );
  expect(classes).not.toContain("rounded-full");
  expect(classes).not.toContain("h-13");
  expect(classes).not.toContain("whitespace-nowrap");
});

test("caps keeps the regular letter spacing below the xl size", () => {
  const view = render(
    <Button caps size="lg">
      Book
    </Button>
  );
  expect(classesOf(view.getByRole("button"))).toContain("tracking-[0.08em]");
});

test("icon sizes are square and round", () => {
  const view = render(
    <Button aria-label="Close" size="icon-sm" variant="ghost">
      x
    </Button>
  );
  expect(classesOf(view.getByRole("button", { name: "Close" }))).toEqual(
    expect.arrayContaining(["size-8", "p-0", "rounded-full"])
  );
});

test("the extra-small icon size fits inside a chip", () => {
  const view = render(
    <Button aria-label="Remove" size="icon-xs" variant="ghost">
      x
    </Button>
  );
  expect(classesOf(view.getByRole("button", { name: "Remove" }))).toEqual(
    expect.arrayContaining(["size-6", "min-h-6", "p-0", "rounded-full"])
  );
});

test("pending disables the action and marks it busy", () => {
  const view = render(<Button pending>Saving</Button>);
  const button = view.getByRole("button", { name: "Saving" });

  expect(button).toHaveProperty("disabled", true);
  expect(button.getAttribute("aria-busy")).toBe("true");
});

test("an idle button is neither disabled nor busy", () => {
  const view = render(<Button>Save</Button>);
  const button = view.getByRole("button", { name: "Save" });

  expect(button).toHaveProperty("disabled", false);
  expect(button.hasAttribute("aria-busy")).toBe(false);
});

test("asChild styles a link without turning it into a button", () => {
  const view = render(
    <Button asChild variant="secondary">
      <a href="/en-US/contact">Contact</a>
    </Button>
  );
  const link = view.getByRole("link", { name: "Contact" });

  expect(link.getAttribute("href")).toBe("/en-US/contact");
  expect(classesOf(link)).toContain("shadow-button-raised-subtle");
  expect(view.queryByRole("button")).toBeNull();
});

test("a link styled as a button can't be pending", () => {
  // @ts-expect-error A link has no disabled state, so it would stay actionable.
  const props: ButtonProps<true> = { asChild: true, pending: true };
  const view = render(
    // biome-ignore lint/plugin: the spread props carry only asChild and pending, no className.
    <Button {...props}>
      <a href="/en-US/checkout">Pay</a>
    </Button>
  );

  expect(view.getByRole("link", { name: "Pay" })).toBeDefined();
});

test("the tile variant is a dashed card-sized action", () => {
  const view = render(<Button variant="tile">Add payment card</Button>);
  const classes = classesOf(view.getByRole("button"));

  expect(classes).toEqual(
    expect.arrayContaining([
      "border-dashed",
      "flex-col",
      "min-h-36",
      "rounded-2xl",
      "whitespace-normal",
    ])
  );
  expect(classes).not.toContain("h-11");
  expect(classes).not.toContain("rounded-full");
});

test("className adds parent layout without replacing the treatment", () => {
  const view = render(<Button className="mt-8 sm:w-auto">Retry</Button>);
  expect(classesOf(view.getByRole("button"))).toEqual(
    expect.arrayContaining(["mt-8", "sm:w-auto", "bg-burned-orange"])
  );
});

test("the link variant drops the button box", () => {
  const view = render(<Button variant="link">Use account details</Button>);
  const classes = classesOf(view.getByRole("button"));

  expect(classes).toEqual(
    expect.arrayContaining([
      "underline",
      "h-auto",
      "px-0",
      "text-burned-orange",
    ])
  );
  expect(classes).not.toContain("h-11");
});

test("buttonVariants matches the rendered Button", () => {
  const view = render(
    <Button size="icon-sm" variant="ghost">
      x
    </Button>
  );
  expect(view.getByRole("button").className).toBe(
    buttonVariants({ size: "icon-sm", variant: "ghost" })
  );
});

test("clicks reach the handler", () => {
  let clicks = 0;
  const view = render(<Button onClick={() => clicks++}>Go</Button>);
  fireEvent.click(view.getByRole("button"));
  expect(clicks).toBe(1);
});
