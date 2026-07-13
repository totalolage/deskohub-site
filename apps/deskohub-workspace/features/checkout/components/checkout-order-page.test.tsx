import { describe, expect, mock, test } from "bun:test";
import { createElement, isValidElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));

const getSuspenseProps = async (input: {
  readonly children: ReactNode;
  readonly fallback: ReactNode;
}) => {
  const { CheckoutOrderPage } = await import("./checkout-order-page");
  const page = CheckoutOrderPage({
    children: input.children,
    fallback: input.fallback,
    locale: "en-US",
  });

  if (!isValidElement(page)) {
    throw new Error("CheckoutOrderPage did not return a React element");
  }

  const rawChildren = (page.props as { children: ReactNode }).children;
  const children = Array.isArray(rawChildren) ? rawChildren : [rawChildren];
  const suspense = children.find(
    (child) => isValidElement(child) && "fallback" in child.props
  );

  if (!isValidElement(suspense)) {
    throw new Error("CheckoutOrderPage did not render a Suspense boundary");
  }

  return suspense.props as { readonly fallback: ReactNode };
};

describe("CheckoutOrderPage", () => {
  test("renders the explicit product fallback", async () => {
    const fallback = createElement("div", {
      "data-testid": "meeting-room-fallback",
    });
    const suspenseProps = await getSuspenseProps({
      children: createElement("div", { "data-testid": "meeting-room-form" }),
      fallback,
    });

    expect(suspenseProps.fallback).toBe(fallback);
  });
});
