import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { createElement } from "react";
import { legalNodeToPhrasing } from "./legal-node-phrasing";

const text = (value: string) => ({ type: "text", value });
const mailto = `mailto:${testEmailAddress("info")}`;

describe("legalNodeToPhrasing", () => {
  test.each([
    ["null", null],
    ["undefined", undefined],
    ["true", true],
    ["false", false],
    ["a bigint", 1n],
  ])("drops %s", (_name, node) => {
    expect(legalNodeToPhrasing(node)).toEqual([]);
  });

  test("keeps strings and numbers, including zero, as text", () => {
    expect(legalNodeToPhrasing("Plain text")).toEqual([text("Plain text")]);
    expect(legalNodeToPhrasing(42)).toEqual([text("42")]);
    expect(legalNodeToPhrasing(0)).toEqual([text("0")]);
  });

  test("flattens arrays in order, dropping empty entries", () => {
    expect(
      legalNodeToPhrasing(["First ", null, ["nested ", false, 2], " last"])
    ).toEqual([text("First "), text("nested "), text("2"), text(" last")]);
  });

  test("replaces a non-anchor element or fragment with its children", () => {
    expect(
      legalNodeToPhrasing(
        <>
          <strong>Bold</strong> and <em>{["a", "b"]}</em>
        </>
      )
    ).toEqual([text("Bold"), text(" and "), text("a"), text("b")]);
    expect(legalNodeToPhrasing(<span />)).toEqual([]);
  });

  test("links an anchor's children to its absolute, locale-agnostic target", () => {
    expect(
      legalNodeToPhrasing(<a href="/cs-CZ/privacy-policy">privacy</a>)
    ).toEqual([
      {
        type: "link",
        url: "https://workspace.deskohub.cz/privacy-policy",
        children: [text("privacy")],
      },
    ]);
    expect(
      legalNodeToPhrasing(
        <a href={mailto}>
          <strong>mail</strong> us
        </a>
      )
    ).toEqual([
      {
        type: "link",
        url: mailto,
        children: [text("mail"), text(" us")],
      },
    ]);
    expect(
      legalNodeToPhrasing(<a href="https://example.test/page">site</a>)
    ).toEqual([
      {
        type: "link",
        url: "https://example.test/page",
        children: [text("site")],
      },
    ]);
  });

  test("keeps only the children of an anchor without a target", () => {
    // Built without JSX: the anchor lint rejects these missing targets.
    expect(legalNodeToPhrasing(createElement("a", {}, "no target"))).toEqual([
      text("no target"),
    ]);
    expect(
      legalNodeToPhrasing(createElement("a", { href: "" }, "empty target"))
    ).toEqual([text("empty target")]);
  });

  test("links an anchor nested inside other elements", () => {
    expect(
      legalNodeToPhrasing(
        <p>
          See{" "}
          <strong>
            the <a href="/terms-and-conditions">terms</a>
          </strong>
          .
        </p>
      )
    ).toEqual([
      text("See"),
      text(" "),
      text("the "),
      {
        type: "link",
        url: "https://workspace.deskohub.cz/terms-and-conditions",
        children: [text("terms")],
      },
      text("."),
    ]);
  });
});
