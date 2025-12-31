import { Effect } from "effect";
import type { NextResponse } from "next/server";
import { DotyposService } from "@/features/dotypos";
import { generateMenuPDF } from "@/features/menu/utils/generate-menu-pdf";

export const GET = (request: Request): Promise<NextResponse> =>
  Effect.runPromise(
    generateMenuPDF(request).pipe(
      Effect.tapError(
        Effect.fn(function* (error) {
          yield* Effect.logError(error);
        })
      ),
      Effect.annotateLogs({
        method: "GET",
        operation: "pdf",
        request,
      }),
      Effect.provide(DotyposService.Default)
    )
  );
