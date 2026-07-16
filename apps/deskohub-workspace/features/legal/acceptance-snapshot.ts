import "server-only";

import { createHash } from "node:crypto";
import { Data, Effect } from "effect";
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

export class LegalAcceptanceSnapshotError extends Data.TaggedError(
  "LegalAcceptanceSnapshotError"
)<{
  readonly cause: unknown;
}> {}

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

const createLegalDocumentHash = Effect.fn("createLegalDocumentHash")(
  (canonicalDocument: string) =>
    Effect.try({
      try: () => createHash("sha256").update(canonicalDocument).digest("hex"),
      catch: (cause) => new LegalAcceptanceSnapshotError({ cause }),
    })
);

const createLegalDocumentSnapshot = Effect.fn("createLegalDocumentSnapshot")(
  (input: {
    readonly locale: Locale;
    readonly documentKey: CheckoutLegalDocumentKey;
  }) =>
    Effect.succeed(input).pipe(
      Effect.let("document", ({ documentKey, locale }) =>
        getLegalDocument(locale, documentKey)
      ),
      Effect.let(
        "path",
        ({ documentKey, locale }) => `/${locale}/${documentKey}`
      ),
      Effect.let("canonicalDocument", ({ document }) =>
        getCanonicalLegalDocument(document)
      ),
      Effect.bind("hash", ({ canonicalDocument }) =>
        createLegalDocumentHash(canonicalDocument)
      ),
      Effect.map(
        ({ document, hash, path }): CheckoutLegalDocumentSnapshot => ({
          path,
          url: getWorkspaceCanonicalUrl(path),
          title: document.title,
          updatedAt: document.updatedAt,
          hash,
          hashAlgorithm: "sha256",
        })
      )
    )
);

export const getLegalAcceptanceSnapshot = Effect.fn(
  "getLegalAcceptanceSnapshot"
)((locale: Locale) =>
  Effect.all({
    termsAndConditions: createLegalDocumentSnapshot({
      locale,
      documentKey: "terms-and-conditions",
    }),
    operatingRules: createLegalDocumentSnapshot({
      locale,
      documentKey: "operating-rules",
    }),
    privacyPolicy: createLegalDocumentSnapshot({
      locale,
      documentKey: "privacy-policy",
    }),
  })
);
