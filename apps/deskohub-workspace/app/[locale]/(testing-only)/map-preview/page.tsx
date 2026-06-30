import { connection } from "next/server";
import { Suspense } from "react";
import { isLocale, type Locale, m } from "@/features/i18n";
import { generateWorkspaceLocationMapImage } from "@/shared/backend/workspace-location-map";
import {
  workspaceFormattedAddress,
  workspaceGoogleDirectionsUrl,
  workspaceLocationMapImageOptions,
} from "@/shared/utils";

type WorkspaceMapPreviewPageProps = {
  params: Promise<{ locale: string }>;
};

export default async function WorkspaceMapPreviewPage({
  params,
}: WorkspaceMapPreviewPageProps) {
  const { locale } = await params;
  if (!isLocale(locale)) return null;

  return (
    <Suspense fallback={null}>
      <WorkspaceMapPreviewContent locale={locale} />
    </Suspense>
  );
}

async function WorkspaceMapPreviewContent({ locale }: { locale: Locale }) {
  await connection();
  const image = await generateWorkspaceLocationMapImage();
  const imageSrc = `data:image/jpeg;base64,${image.toString("base64")}`;

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-4 py-10 text-[#00024f]">
      <div className="mx-auto max-w-[600px] rounded-[20px] border border-[#e6ded2] bg-[#f4f1ea] shadow-2xl shadow-navy-blue/12">
        <div className="px-5 py-[18px]">
          <div className="mb-[7px] font-extrabold text-[#006b55] text-xs uppercase tracking-[0.16em]">
            {m.checkoutEmailLocationHeading({}, { locale })}
          </div>
          <a
            className="inline-block font-bold text-[#00024f] text-[17px] leading-[1.45] no-underline"
            href={workspaceGoogleDirectionsUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {workspaceFormattedAddress}
          </a>
        </div>
        {/* biome-ignore lint/performance/noImgElement: This preview renders a request-generated data URI. */}
        <img
          alt={m.checkoutEmailLocationHeading({}, { locale })}
          src={imageSrc}
          style={{
            border: 0,
            display: "block",
            height: "auto",
            width: "100%",
          }}
          height={workspaceLocationMapImageOptions.height}
          width={workspaceLocationMapImageOptions.width}
        />
        <div className="bg-[#f4f1ea] px-5 pt-0 pb-[22px] text-center">
          <a
            className="relative z-[1] mt-[-24px] inline-block rounded-full border border-[#00024f] bg-[#00024f] px-7 py-3.5 text-center font-extrabold text-[#f4f1ea] text-[15px] leading-5 no-underline"
            href={workspaceGoogleDirectionsUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            {m.checkoutEmailLocationMapLink({}, { locale })}
          </a>
        </div>
      </div>
    </main>
  );
}
