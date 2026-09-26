import { describe, expect, mock, test } from "bun:test";
import { cloneElement, createElement } from "react";
import type { LegalDocumentContent } from "@/features/legal/content";
import { getLegalDocument as getRealLegalDocument } from "@/features/legal/content";

let getLegalDocument: (
  ...args: Parameters<typeof getRealLegalDocument>
) => ReturnType<typeof getRealLegalDocument> = getRealLegalDocument;

mock.module("@/features/legal/content", () => ({
  getLegalDocument: (
    ...args: Parameters<typeof getRealLegalDocument>
  ): ReturnType<typeof getRealLegalDocument> => getLegalDocument(...args),
}));

const { getWorkspaceE2EMarketingDocumentHash } = await import(
  "./marketing-document-hash"
);

// Installs a synthetic runtime body on an already typed document, so stub
// objects and malformed shapes reach the helper without type assertions.
const withSyntheticBody = (body: readonly unknown[], run: () => void) => {
  const source = getRealLegalDocument("en-US", "marketing-communications");
  const firstSection = {
    heading: source.sections[0]?.heading ?? "Synthetic section",
    body: [],
  };
  const synthetic: LegalDocumentContent = {
    ...source,
    sections: [firstSection],
  };
  Object.defineProperty(firstSection, "body", { value: body });
  const previous = getLegalDocument;
  getLegalDocument = () => synthetic;
  try {
    run();
  } finally {
    getLegalDocument = previous;
  }
};

const stub = (fields: Record<string, unknown>): unknown => fields;

const expectedHashFor = (body: readonly string[]) => {
  const document = getRealLegalDocument("en-US", "marketing-communications");
  const canonical = JSON.stringify({
    title: document.title,
    lead: document.lead,
    updatedAt: document.updatedAt,
    sections: [{ heading: document.sections[0]?.heading, body }],
  });
  return import("node:crypto").then(({ createHash }) =>
    createHash("sha256").update(canonical).digest("hex")
  );
};

describe("getWorkspaceE2EMarketingDocumentHash", () => {
  test("real en-US marketing document matches the production hash", () => {
    expect(getWorkspaceE2EMarketingDocumentHash()).toBe(
      "75655dda4406b51fd74d1151a8d28443b75e580728c203cef54c2483ec3ed02d"
    );
  });

  test("normalizes Playwright JSX stubs into real fragments", async () => {
    const fragmentStub = stub({
      __pw_type: "jsx",
      type: { __pw_jsx_fragment: true },
      props: {
        children: [
          "link",
          stub({
            __pw_type: "jsx",
            type: "a",
            props: { href: "https://example.test", children: "text" },
            key: null,
          }),
        ],
      },
      key: null,
    });
    let hash = "";
    withSyntheticBody([fragmentStub], () => {
      hash = getWorkspaceE2EMarketingDocumentHash();
    });
    expect(hash).toBe(await expectedHashFor(["linktext"]));
  });

  test("real elements with stub children are cloned, never rendered", async () => {
    const StubHost = (_props: { readonly children?: unknown }): null => null;
    const stubChild = stub({
      __pw_type: "jsx",
      type: { __pw_jsx_fragment: true },
      props: { children: "inner" },
      key: null,
    });
    // Runtime children injection: the stub child is not a ReactNode, so the
    // mixed parent is assembled through cloneElement's normalized props.
    const realParent = cloneElement(createElement(StubHost, {}), {
      children: stubChild,
    });
    let hash = "";
    withSyntheticBody([realParent], () => {
      hash = getWorkspaceE2EMarketingDocumentHash();
    });
    expect(hash).toBe(await expectedHashFor(["inner"]));
  });

  test("component functions inside stubs are never executed", async () => {
    const neverCalled = () => {
      throw new Error("component function must not run");
    };
    const componentStub = stub({
      __pw_type: "jsx",
      type: neverCalled,
      props: { children: "safe" },
      key: null,
    });
    let hash = "";
    withSyntheticBody([componentStub], () => {
      hash = getWorkspaceE2EMarketingDocumentHash();
    });
    expect(hash).toBe(await expectedHashFor(["safe"]));
  });

  test("primitives and arrays pass through unchanged", async () => {
    let hash = "";
    withSyntheticBody(["plain", 7, ["nested", true, null, undefined]], () => {
      hash = getWorkspaceE2EMarketingDocumentHash();
    });
    expect(hash).toBe(await expectedHashFor(["plain", "7", "nested"]));
  });

  test("malformed stubs fail with the fixed non-sensitive message", () => {
    const malformedStubs: readonly unknown[] = [
      stub({
        __pw_type: "div",
        type: "a",
        props: { children: "x" },
        key: null,
      }),
      stub({ __pw_type: "jsx", type: "a", props: { children: "x" } }),
      stub({
        __pw_type: "jsx",
        type: { unexpected: true },
        props: { children: "x" },
        key: null,
      }),
      stub({
        __pw_type: "jsx",
        type: "a",
        props: ["not", "record"],
        key: null,
      }),
      stub({ __pw_type: "jsx", type: "a", props: { children: "x" }, key: 7 }),
      { unexpected: "shape" },
    ];
    for (const node of malformedStubs) {
      withSyntheticBody([node], () => {
        expect(() => getWorkspaceE2EMarketingDocumentHash()).toThrow(
          "Unsupported React node shape in the marketing communications document"
        );
      });
    }
  });
});
