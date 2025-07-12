"use client";

import Image from "next/image";
import logoImage from "@/assets/images/logo.png";
import { LanguageSwitcher } from "@/features/i18n";
import { m, setLocale } from "@/i18n";
import { useLocale } from "@/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import Link from "next/link";

export function Header() {
  const locale = useLocale();
  setLocale(locale, { reload: false });

  return (
    <header className="bg-black text-white px-6 sticky top-0 z-20 h-[var(--header-height)] flex items-center justify-center">
      <div className="flex items-center justify-between max-w-7xl w-full gap-x-8">
        <Link href="/">
          <Image
            src={logoImage}
            alt={m["altText.deskohub"]()}
            width={100}
            height={80}
          />
        </Link>
        <nav className="hidden md:flex space-x-8">
          <Link href="/" className="hover:text-green-400 transition-colors">
            {m["nav.home"]()}
          </Link>
          <Link
            href="/board-games"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.boardGames"]()}
          </Link>
          <Link
            href="/gallery"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.gallery"]()}
          </Link>
          <Link href="/menu" className="hover:text-green-400 transition-colors">
            {m["nav.menu"]()}
          </Link>
          <Link
            href="/training-room"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.trainingRoom"]()}
          </Link>
          <Link
            href="/contact"
            className="hover:text-green-400 transition-colors"
          >
            {m["nav.contact"]()}
          </Link>
        </nav>
        <div className="flex items-center space-x-4">
          <LanguageSwitcher />
          <Link href="/reservation">
            <Button className="bg-green-500 hover:bg-green-600 text-white">
              {m["buttons.reservation"]()}
            </Button>
          </Link>
        </div>
      </div>
    </header>
  );
}
