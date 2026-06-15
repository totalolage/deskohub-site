import { Effect } from "effect";
import { NextResponse } from "next/server";
import { generateMenuPdf, MenuData } from "@/features/menu";
import { NextRoute } from "@/shared/api/next-route";

export const GET = NextRoute.GET({
  effect: Effect.gen(function* () {
    yield* Effect.logInfo("Menu PDF generation started");
    const menuPdfStream = yield* generateMenuPdf.pipe(
      Effect.provide(MenuData.Default)
    );
    yield* Effect.logInfo("Menu PDF generation succeeded");

    // @ts-expect-error - NextResponse is not typed correctly int he latest Next.js version, remove once it's fixed
    const response = new NextResponse(menuPdfStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
      },
    });
    yield* Effect.logInfo("Menu PDF response ready");
    return response;
  }),
  fallback: () => new NextResponse("Failed to generate PDF", { status: 500 }),
});
