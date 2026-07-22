import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { connection } from "next/server";
import { Suspense } from "react";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { WorkspaceEffect } from "@/shared/backend/workspace-effect";
import { DotyposTablesPreview } from "./dotypos-tables-preview";

const DotyposLive = Layer.provide(
  DotyposService.Default,
  DotyposRuntimeConfigLive
);

export default function DotyposTablesPreviewPage() {
  return (
    <Suspense fallback={null}>
      <DotyposTablesPreviewContent />
    </Suspense>
  );
}

const DotyposTablesPreviewContent = WorkspaceEffect.page(
  { operation: "dotypos.tables-preview.render", layer: DotyposLive },
  () =>
    Effect.gen(function* () {
      yield* Effect.promise(() => connection());
      const dotypos = yield* DotyposService;
      const tables = yield* dotypos.getTables().pipe(
        Effect.tapError((error) =>
          Effect.logError("Workspace Dotypos table preview load failed", error)
        ),
        Effect.orDie
      );

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
                Loaded {tables.length} tables from the workspace Dotypos
                service.
              </p>
            </div>

            <DotyposTablesPreview tables={tables} />
          </div>
        </main>
      );
    })
);
