import { createHash } from "node:crypto";
import { Predicate } from "effect";
import type { ReactNode } from "react";
import { cloneElement, createElement, Fragment, isValidElement } from "react";
import { getCanonicalLegalDocument } from "@/features/legal/canonical-document";
import { getLegalDocument } from "@/features/legal/content";

const unsupportedNodeMessage =
  "Unsupported React node shape in the marketing communications document";

// The stub keys are source-defined by Playwright's jsx-runtime.js; every field
// is validated at runtime before use, no type assertions.
const stubKeys = ["__pw_type", "key", "props", "type"] as const;

// Effect's isObject accepts arrays too; records here must exclude them.
const isRecord = (value: unknown): value is Record<string, unknown> =>
  Predicate.isObject(value) && !Array.isArray(value);

const isWorkspaceE2EPwFragmentType = (type: unknown): boolean =>
  isRecord(type) &&
  Object.keys(type).length === 1 &&
  type.__pw_jsx_fragment === true;

const isWorkspaceE2EPwJsxStubKeyed = (
  node: Record<string, unknown>
): boolean => {
  const keys = Object.keys(node);
  return (
    keys.length === stubKeys.length &&
    stubKeys.every((stubKey) => keys.includes(stubKey)) &&
    node.__pw_type === "jsx"
  );
};

/**
 * The Playwright test runner compiles JSX in transformed modules to plain
 * stub objects instead of real React elements. This normalizer is E2E-only:
 * it converts those stubs back into real fragment elements so the shared
 * production canonicalizer observes the same tree it sees under Next.
 * Real elements keep their component functions untouched; only their
 * children are normalized in place via cloneElement.
 */
const normalizeWorkspaceE2EMarketingNode = (node: unknown): ReactNode => {
  if (
    node === null ||
    node === undefined ||
    Predicate.isBoolean(node) ||
    Predicate.isString(node) ||
    Predicate.isNumber(node)
  ) {
    return node;
  }

  if (Array.isArray(node)) {
    return node.map(normalizeWorkspaceE2EMarketingNode);
  }

  if (isValidElement<{ readonly children?: unknown }>(node)) {
    const normalizedChildren = normalizeWorkspaceE2EMarketingNode(
      node.props.children
    );
    return normalizedChildren === node.props.children
      ? node
      : cloneElement(node, { children: normalizedChildren });
  }

  if (isRecord(node) && isWorkspaceE2EPwJsxStubKeyed(node)) {
    const { type, props, key } = node;
    const typeValid =
      Predicate.isString(type) ||
      Predicate.isFunction(type) ||
      isWorkspaceE2EPwFragmentType(type);
    const propsValid = props === null || isRecord(props);
    const keyValid =
      Predicate.isString(key) || key === null || key === undefined;
    if (!typeValid || !propsValid || !keyValid) {
      throw new Error(unsupportedNodeMessage);
    }
    const rawChildren = props === null ? null : (props.children ?? null);
    return createElement(
      Fragment,
      null,
      normalizeWorkspaceE2EMarketingNode(rawChildren)
    );
  }

  throw new Error(unsupportedNodeMessage);
};

/**
 * The single marketing-preferences E2E document hash: the exact shared
 * production canonical JSON over the en-US marketing-communications document
 * with Playwright JSX stubs normalized back into real React nodes.
 */
export const getWorkspaceE2EMarketingDocumentHash = (): string => {
  const document = getLegalDocument("en-US", "marketing-communications");
  const normalizedDocument = {
    title: document.title,
    lead: document.lead,
    updatedAt: document.updatedAt,
    sections: document.sections.map((section) => ({
      heading: section.heading,
      body: section.body.map((node) =>
        normalizeWorkspaceE2EMarketingNode(node)
      ),
    })),
  };
  return createHash("sha256")
    .update(getCanonicalLegalDocument(normalizedDocument))
    .digest("hex");
};
