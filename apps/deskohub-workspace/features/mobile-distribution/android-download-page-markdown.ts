import { Effect } from "effect";
import type { PhrasingContent } from "mdast";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { type Locale, m } from "@/features/i18n";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import {
  type MarkdownBlocks,
  markdownHeading,
  markdownInlineCode,
  markdownInterpolate,
  markdownLink,
  markdownList,
  markdownListItem,
  markdownOrderedList,
  markdownParagraph,
} from "@/shared/markdown/markdown";
import {
  type AndroidDownload,
  androidReleasesListUrl,
  getAndroidReleaseFacts,
} from "./android-download";
import { loadAndroidDownload } from "./backend/android-download.server";
import { obtainiumImportUrl } from "./obtainium-link";

const releaseMarkdown = (
  locale: Locale,
  release: AndroidRelease
): MarkdownBlocks => {
  const facts = getAndroidReleaseFacts(release, locale);
  return [
    markdownHeading(2, m.androidPageLatestHeading({}, { locale })),
    markdownList([
      markdownListItem(
        `${m.androidPageVersionLabel({}, { locale })}: ${facts.version}`
      ),
      markdownListItem(
        `${m.androidPageSizeLabel({}, { locale })}: ${facts.size}`
      ),
      markdownListItem(
        `${m.androidPageReleaseDateLabel({}, { locale })}: ${facts.date}`
      ),
    ]),
    markdownParagraph(
      markdownLink(release.apkUrl, m.androidPageDownloadLink({}, { locale }))
    ),
    markdownHeading(2, m.androidPageObtainiumHeading({}, { locale })),
    markdownParagraph(m.androidPageObtainiumBody({}, { locale })),
    markdownParagraph(
      markdownLink(
        obtainiumImportUrl,
        m.androidPageObtainiumBadgeAlt({}, { locale })
      )
    ),
  ];
};

const downloadMarkdown = (
  locale: Locale,
  download: AndroidDownload
): MarkdownBlocks => {
  switch (download.kind) {
    case "release":
      return releaseMarkdown(locale, download.release);
    case "none":
      return [markdownParagraph(m.androidPageComingSoon({}, { locale }))];
    case "unavailable":
      return [
        markdownParagraph(
          ...markdownInterpolate(m.androidPageUnavailable({}, { locale }), {
            releases: (content: PhrasingContent[]) =>
              markdownLink(androidReleasesListUrl, ...content),
          })
        ),
      ];
  }
};

/**
 * The Android download page as Markdown: the latest release, or why there is
 * none, then the install steps and the signing certificate.
 */
export const renderAndroidDownloadMarkdown = (
  locale: Locale,
  download: AndroidDownload
): MarkdownBlocks => [
  markdownHeading(1, m.androidPageTitle({}, { locale })),
  markdownParagraph(m.androidPageLead({}, { locale })),
  ...downloadMarkdown(locale, download),
  markdownHeading(2, m.androidPageInstallHeading({}, { locale })),
  markdownOrderedList([
    markdownListItem(m.androidPageInstallStepOpen({}, { locale })),
    markdownListItem(m.androidPageInstallStepAllow({}, { locale })),
    markdownListItem(m.androidPageInstallStepConfirm({}, { locale })),
  ]),
  markdownHeading(2, m.androidPageCertificateHeading({}, { locale })),
  markdownParagraph(m.androidPageCertificateBody({}, { locale })),
  markdownParagraph(markdownInlineCode(nativeApp.androidReleaseCertificate)),
];

export const androidDownloadPageMarkdown = (
  locale: Locale
): Effect.Effect<MarkdownBlocks> =>
  Effect.map(loadAndroidDownload, (download) =>
    renderAndroidDownloadMarkdown(locale, download)
  );
