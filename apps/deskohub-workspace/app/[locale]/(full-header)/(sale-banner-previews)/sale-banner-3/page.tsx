import {
  SaleBannerPreviewPage,
  saleBannerPreviewMetadata,
} from "../_preview/sale-banner-preview-page";

export const metadata = saleBannerPreviewMetadata;

export default function SaleBannerThreePreviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  return <SaleBannerPreviewPage params={params} />;
}
