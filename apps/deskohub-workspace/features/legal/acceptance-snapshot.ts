"use server";

import { createHash } from "node:crypto";
import { Children, isValidElement, type ReactNode } from "react";
import type { Locale } from "@/features/i18n";
import { getWorkspaceCanonicalUrl } from "@/shared/utils";
import { getLegalDocument, type LegalDocumentContent } from "./content";

type CheckoutLegalDocumentKey =
  | "terms-and-conditions"
  | "operating-rules"
  | "privacy-policy";

type CheckoutLegalDocumentSnapshot = {
  readonly path: string;
  readonly url: string;
  readonly title: string;
  readonly updatedAt: string;
  readonly hash: string;
  readonly hashAlgorithm: "sha256";
};

export type CheckoutLegalAcceptanceSnapshot = {
  readonly termsAndConditions: CheckoutLegalDocumentSnapshot;
  readonly operatingRules: CheckoutLegalDocumentSnapshot;
  readonly privacyPolicy: CheckoutLegalDocumentSnapshot;
};

function reactNodeToCanonicalText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }

  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }

  if (Array.isArray(node)) {
    return Children.toArray(node).map(reactNodeToCanonicalText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(node)) {
    return reactNodeToCanonicalText(node.props.children);
  }

  return "";
}

function getCanonicalLegalDocument(document: LegalDocumentContent): string {
  return JSON.stringify({
    title: document.title,
    lead: document.lead,
    updatedAt: document.updatedAt,
    sections: document.sections.map((section) => ({
      heading: section.heading,
      body: section.body.map(reactNodeToCanonicalText),
    })),
  });
}

function createLegalDocumentSnapshot(
  locale: Locale,
  documentKey: CheckoutLegalDocumentKey
): CheckoutLegalDocumentSnapshot {
  const document = getLegalDocument(locale, documentKey);
  const path = `/${locale}/${documentKey}`;

  return {
    path,
    url: getWorkspaceCanonicalUrl(path),
    title: document.title,
    updatedAt: document.updatedAt,
    hash: createHash("sha256")
      .update(getCanonicalLegalDocument(document))
      .digest("hex"),
    hashAlgorithm: "sha256",
  };
}

export async function getLegalAcceptanceSnapshot(
  locale: Locale
): Promise<CheckoutLegalAcceptanceSnapshot> {
  "use cache";

  return {
    termsAndConditions: createLegalDocumentSnapshot(
      locale,
      "terms-and-conditions"
    ),
    operatingRules: createLegalDocumentSnapshot(locale, "operating-rules"),
    privacyPolicy: createLegalDocumentSnapshot(locale, "privacy-policy"),
  };
}
