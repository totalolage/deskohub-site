import { sharedWorkspaceContract } from "@deskohub/workspace-shared";
import { Effect } from "effect";
import { workspaceStatusProgram } from "@/features/effect/workspace-program";
import {
  defaultWorkspaceLocale,
  getWorkspaceCopy,
} from "@/features/i18n/dictionary";

export default function WorkspaceHomePage() {
  const copy = getWorkspaceCopy(defaultWorkspaceLocale);
  const runtimeStatus = Effect.runSync(workspaceStatusProgram);

  return (
    <main>
      <span className="workspace-pill">{sharedWorkspaceContract.scope}</span>
      <h1>{copy.title}</h1>
      <p>{copy.description}</p>
      <section className="workspace-card">
        <p>
          <strong>Effect:</strong> {runtimeStatus}
        </p>
        <p>
          <strong>Shared package:</strong> {sharedWorkspaceContract.version}
        </p>
        <p>
          TODO: replace static copy with generated Paraglide messages once the
          first workspace routes are localized.
        </p>
      </section>
    </main>
  );
}
