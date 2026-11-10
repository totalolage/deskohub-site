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
const { getLegalDocumentVersion, hashLegalDocument } = await import(
  "@/features/legal/document-version"
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

// The production hash of the en-US document with its first section's body
// replaced by already-canonical text.
const expectedHashFor = (body: readonly string[]) => {
  const document = getRealLegalDocument("en-US", "marketing-communications");
  return hashLegalDocument({
    ...document,
    sections: [
      {
        heading: document.sections[0]?.heading ?? "Synthetic section",
        body: [...body],
      },
    ],
  });
};

describe("getWorkspaceE2EMarketingDocumentHash", () => {
  test("equals the version the app records for the en-US document", () => {
    expect(getWorkspaceE2EMarketingDocumentHash()).toBe(
      getLegalDocumentVersion("en-US", "marketing-communications")
    );
  });

  test("normalizes Playwright JSX stubs into real fragments", () => {
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
    expect(hash).toBe(expectedHashFor(["linktext"]));
  });

  test("real elements with stub children are cloned, never rendered", () => {
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
    expect(hash).toBe(expectedHashFor(["inner"]));
  });

  test("component functions inside stubs are never executed", () => {
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
    expect(hash).toBe(expectedHashFor(["safe"]));
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
