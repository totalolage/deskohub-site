import { Effect } from "effect";
import { NextResponse } from "next/server";
import { generateMenuPdf, MenuData } from "@/features/menu";
import { NextRoute } from "@/shared/api/next-route";

export const GET = NextRoute.GET({
  effect: Effect.gen(function* () {
    const menuPdfStream = yield* generateMenuPdf.pipe(
      Effect.provide(MenuData.Default)
    );

    // @ts-expect-error - NextResponse is not typed correctly int he latest Next.js version, remove once it's fixed
    return new NextResponse(menuPdfStream, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'attachment; filename="deskohub-menu.pdf"',
      },
    });
  }),
  fallback: () => new NextResponse("Failed to generate PDF", { status: 500 }),
});
