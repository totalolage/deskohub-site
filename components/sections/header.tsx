"use client";

import Image from "next/image";
import logoImage from "@/assets/images/logo.png";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Button } from "@/components/ui/button";
import { m } from "@/i18n";
import Link from "next/link";
import { useLocale } from "@/i18n/translations/use-locale";

export function Header() {
  // Force re-render when locale changes
  const currentLocale = useLocale();
  return (
    <header className="bg-black text-white px-6 sticky top-0 z-20 h-[var(--header-height)] flex items-center justify-center">
      <div className="flex items-center justify-between max-w-7xl w-full">
        <Image src={logoImage} alt="Deskohub" width={100} height={80} />
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
          <Link href="/gallery" className="hover:text-green-400 transition-colors">
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
          <Link href="/contact" className="hover:text-green-400 transition-colors">
            {m["nav.contact"]()}
          </Link>
        </nav>
        <div className="flex items-center space-x-4">
          <LanguageSwitcher />
          <Button className="bg-green-500 hover:bg-green-600 text-white">
            {m["buttons.reservation"]()}
          </Button>
        </div>
      </div>
    </header>
  );
}
