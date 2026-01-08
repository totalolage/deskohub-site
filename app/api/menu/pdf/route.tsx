import { Effect } from "effect";
import type { NextResponse } from "next/server";
import { generateMenuPdfResponse, MenuService } from "@/features/menu";

export const GET = (request: Request): Promise<NextResponse> =>
  Effect.runPromise(
    generateMenuPdfResponse(request).pipe(
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
      Effect.provide(MenuService.Default)
    )
  );
