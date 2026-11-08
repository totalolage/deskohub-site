import Interpolate from "@doist/react-interpolate";
import { Download } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { type Locale, m } from "@/features/i18n";
import type { AndroidRelease } from "@/features/mobile-releases/backend/latest-android-release.server";
import { Container } from "@/shared/components/container";
import { Button } from "@/shared/components/ui/button";
import { textLink } from "@/shared/components/ui/text-link";
import {
  type AndroidDownload,
  androidReleasesListUrl,
  getAndroidReleaseFacts,
} from "../android-download";
import obtainiumBadge from "../images/badge-obtainium.png";
import { obtainiumImportUrl } from "../obtainium-link";

interface AndroidDownloadPageProps {
  readonly locale: Locale;
  readonly download: AndroidDownload;
}

export function AndroidDownloadPage({
  locale,
  download,
}: AndroidDownloadPageProps) {
  return (
    <main className="min-h-dvh overflow-x-clip bg-[linear-gradient(180deg,#05083f_0%,#0d1258_45%,#15123e_100%)] pb-20 pt-[calc(var(--site-header-height)+4rem)] text-white sm:pb-24 sm:pt-[calc(var(--site-header-height)+5rem)]">
      <Container className="max-w-3xl">
        <h1 className="text-4xl leading-tight text-balance sm:text-5xl">
          {m.androidPageTitle({}, { locale })}
        </h1>
        <p className="mt-6 text-lg leading-8 text-white/76">
          {m.androidPageLead({}, { locale })}
        </p>

        {download.kind === "release" && (
          <AndroidReleaseDownload locale={locale} release={download.release} />
        )}
        {download.kind === "none" && (
          <p className="mt-10 rounded-2xl border border-white/14 bg-white/6 p-6 text-base leading-7 text-white/86">
            {m.androidPageComingSoon({}, { locale })}
          </p>
        )}
        {download.kind === "unavailable" && (
          <p className="mt-10 rounded-2xl border border-white/14 bg-white/6 p-6 text-base leading-7 text-white/86">
            <Interpolate
              string={m.androidPageUnavailable({}, { locale })}
              mapping={{
                releases: (content: ReactNode) => (
                  <a
                    className={textLink({ tone: "inverse" })}
                    href={androidReleasesListUrl}
                  >
                    {content}
                  </a>
                ),
              }}
            />
          </p>
        )}

        <section aria-labelledby="android-install" className="mt-14">
          <h2
            className="text-2xl text-sunset-yellow sm:text-3xl"
            id="android-install"
          >
            {m.androidPageInstallHeading({}, { locale })}
          </h2>
          <ol className="mt-5 list-decimal space-y-3 pl-6 text-base leading-7 text-white/86 marker:font-semibold marker:text-burned-orange">
            <li>{m.androidPageInstallStepOpen({}, { locale })}</li>
            <li>{m.androidPageInstallStepAllow({}, { locale })}</li>
            <li>{m.androidPageInstallStepConfirm({}, { locale })}</li>
          </ol>
        </section>

        <section aria-labelledby="android-certificate" className="mt-14">
          <h2
            className="text-2xl text-sunset-yellow sm:text-3xl"
            id="android-certificate"
          >
            {m.androidPageCertificateHeading({}, { locale })}
          </h2>
          <p className="mt-4 text-base leading-7 text-white/76">
            {m.androidPageCertificateBody({}, { locale })}
          </p>
          <code className="mt-4 block break-all rounded-xl bg-black/30 p-4 font-mono text-sm leading-6 text-white">
            {nativeApp.androidReleaseCertificate}
          </code>
        </section>
      </Container>
    </main>
  );
}

function AndroidReleaseDownload({
  locale,
  release,
}: {
  readonly locale: Locale;
  readonly release: AndroidRelease;
}) {
  const facts = getAndroidReleaseFacts(release, locale);

  return (
    <>
      <section
        aria-labelledby="android-latest"
        className="mt-10 rounded-2xl border border-white/14 bg-white/6 p-6"
      >
        <h2 className="text-xl font-semibold" id="android-latest">
          {m.androidPageLatestHeading({}, { locale })}
        </h2>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
          <dt className="text-white/64">
            {m.androidPageVersionLabel({}, { locale })}
          </dt>
          <dd className="font-semibold">{facts.version}</dd>
          <dt className="text-white/64">
            {m.androidPageSizeLabel({}, { locale })}
          </dt>
          <dd>
            <data value={release.apkSizeBytes}>{facts.size}</data>
          </dd>
          <dt className="text-white/64">
            {m.androidPageReleaseDateLabel({}, { locale })}
          </dt>
          <dd>
            <time dateTime={release.publishedAt}>{facts.date}</time>
          </dd>
        </dl>
        <Button asChild className="mt-6" size="lg">
          <a href={release.apkUrl}>
            <Download aria-hidden="true" />
            {m.androidPageDownloadLink({}, { locale })}
          </a>
        </Button>
      </section>

      <section aria-labelledby="android-obtainium" className="mt-14">
        <h2
          className="text-2xl text-sunset-yellow sm:text-3xl"
          id="android-obtainium"
        >
          {m.androidPageObtainiumHeading({}, { locale })}
        </h2>
        <p className="mt-4 text-base leading-7 text-white/76">
          {m.androidPageObtainiumBody({}, { locale })}
        </p>
        <a
          className="mt-5 inline-block rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sunset-yellow"
          href={obtainiumImportUrl}
        >
          <Image
            alt={m.androidPageObtainiumBadgeAlt({}, { locale })}
            className="h-14 w-auto"
            src={obtainiumBadge}
          />
        </a>
      </section>
    </>
  );
}
