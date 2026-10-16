// TEMPORARY passkey prototype harness (#635). Delete this route once the
// client slice wires the real sign-in page.

import { Option, Schema } from "effect";
import { connection } from "next/server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";
import { requireWorkspaceTestingOnlyAccess } from "@/shared/utils/testing-only";
import { SignInPasskeysPreview } from "./sign-in-passkeys-preview";

export const instant = false;

const decodePreviewSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    outcome: Schema.optional(Schema.Literals(["pending", "fails"])),
  })
);

export default async function SignInPasskeysPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  requireWorkspaceTestingOnlyAccess();
  await connection();
  const { outcome } = Option.getOrElse(
    decodePreviewSearchParams(await searchParams),
    () => ({ outcome: undefined })
  );

  return runWithRequestLocale((locale) => (
    <main className="relative min-h-[calc(100vh-var(--site-header-height))] overflow-hidden bg-[#f4f3ef] px-4 pb-20 pt-[calc(var(--site-header-height)+4rem)] sm:px-6">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(236,164,35,0.22),transparent_34%),radial-gradient(circle_at_85%_75%,rgba(0,223,153,0.12),transparent_30%)]" />
      <div className="relative mx-auto flex max-w-lg justify-center">
        <SignInPasskeysPreview locale={locale} outcome={outcome ?? "fails"} />
      </div>
    </main>
  ));
}
