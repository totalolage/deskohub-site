// TEMPORARY passkey prototype harness (#635). Delete this route once the
// client slice wires the real screens.

import { Option, Schema } from "effect";
import { connection } from "next/server";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParamsDecoder,
  type SearchParamsRecord,
} from "@/shared/utils";
import { requireWorkspaceTestingOnlyAccess } from "@/shared/utils/testing-only";
import { PasskeysPreview } from "./passkeys-preview";

export const instant = false;

const decodePreviewSearchParams = getSearchParamsDecoder(
  Schema.Struct({
    view: Schema.optional(
      Schema.Literals(["security", "prompt", "delete-account"])
    ),
    passkeys: Schema.optional(Schema.Literals(["0", "1", "2"])),
    session: Schema.optional(Schema.Literals(["fresh", "stale"])),
    outcome: Schema.optional(
      Schema.Literals(["succeeds", "fails", "wrong-account"])
    ),
  })
);

export default async function PasskeysPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParamsRecord>;
}) {
  requireWorkspaceTestingOnlyAccess();
  await connection();
  const params = Option.getOrElse(
    decodePreviewSearchParams(await searchParams),
    () => ({})
  );

  return runWithRequestLocale((locale) => (
    <PasskeysPreview
      locale={locale}
      state={{
        view: params.view ?? "security",
        passkeys: Number(params.passkeys ?? "2") as 0 | 1 | 2,
        session: params.session ?? "fresh",
        outcome: params.outcome ?? "succeeds",
      }}
    />
  ));
}
