import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { connection } from "next/server";
import { Suspense } from "react";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { DotyposTablesPreview } from "./dotypos-tables-preview";

const DotyposLive = Layer.provide(
  DotyposService.Default,
  DotyposRuntimeConfigLive
);

const loadTables = () =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* dotypos.getTables();
  }).pipe(
    Effect.provide(DotyposLive),
    Effect.tapError((error) =>
      Effect.logError("Workspace Dotypos table preview load failed", error)
    ),
    runWorkspaceEffect
  );

export default function DotyposTablesPreviewPage() {
  return (
    <Suspense fallback={null}>
      <DotyposTablesPreviewContent />
    </Suspense>
  );
}

async function DotyposTablesPreviewContent() {
  await connection();
  const tables = await loadTables();

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10 text-[#00024f]">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6">
          <p className="font-extrabold text-[#006b55] text-xs uppercase tracking-[0.16em]">
            Testing-only preview
          </p>
          <h1 className="mt-2 font-black text-4xl tracking-tight">
            Dotypos table map
          </h1>
          <p className="mt-2 text-stone-700">
            Loaded {tables.length} tables from the workspace Dotypos service.
          </p>
        </div>

        <DotyposTablesPreview tables={tables} />
      </div>
    </main>
  );
}
