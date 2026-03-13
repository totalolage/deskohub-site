import { Effect } from "effect";
import { notFound } from "next/navigation";
import { workspaceStatusProgram } from "@/features/effect/workspace-program";
import { isWorkspaceLocale, LanguageSwitcher, m } from "@/features/i18n";
import { sharedWorkspaceContract } from "@/features/shared/workspace-contract";

type LocalizedWorkspaceHomePageProps = {
  params: Promise<{ locale: string }>;
};

export default async function LocalizedWorkspaceHomePage({
  params,
}: LocalizedWorkspaceHomePageProps) {
  const { locale } = await params;
  if (!isWorkspaceLocale(locale)) notFound();

  const runtimeStatus = Effect.runSync(workspaceStatusProgram);

  return (
    <main>
      <span>{sharedWorkspaceContract.scope}</span>
      <LanguageSwitcher
        currentLocale={locale}
        pathname={`/${locale}`}
        labels={{
          "en-US": m.languageEnglish({}, { locale }),
          "cs-CZ": m.languageCzech({}, { locale }),
        }}
      />
      <h1>{m.workspaceTitle({}, { locale })}</h1>
      <p>{m.workspaceDescription({}, { locale })}</p>
      <section>
        <p>
          <strong>{m.effectLabel({}, { locale })}:</strong> {runtimeStatus}
        </p>
        <p>
          <strong>{m.sharedPackageLabel({}, { locale })}:</strong>{" "}
          {sharedWorkspaceContract.version}
        </p>
        <p>{m.workspaceStatusNote({}, { locale })}</p>
      </section>
    </main>
  );
}
