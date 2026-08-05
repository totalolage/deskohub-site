import { expect, mock, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";

mock.module("server-only", () => ({}));

const { createReservationPage } = await import(
  "./create-reservation-page.server"
);

test("renders the reservation shell before request-bound content resolves", async () => {
  const render = mock((): ReactNode => "loaded reservation form");
  const fallback = mock((): ReactNode => "loading reservation form");
  const searchParams = new Promise<Record<string, string>>(() => undefined);
  const pageDefinition = createReservationPage({
    fallback,
    kind: "cowork",
    metadata: () => ({ description: "Description", title: "Title" }),
    pathname: "/reservation/cowork",
    render,
  });

  const page = await pageDefinition.Page({
    params: Promise.resolve({ locale: "en-US" }),
    searchParams,
  });

  expect(render).not.toHaveBeenCalled();
  expect(fallback).toHaveBeenCalledWith("en-US");
  expect(isValidElement(page)).toBe(true);

  const pageProps = (
    page as ReactElement<{
      readonly children: ReactNode;
      readonly fallback: ReactNode;
      readonly locale: string;
    }>
  ).props;

  expect(pageProps).toMatchObject({
    fallback: "loading reservation form",
    locale: "en-US",
  });
  expect(isValidElement(pageProps.children)).toBe(true);
});
