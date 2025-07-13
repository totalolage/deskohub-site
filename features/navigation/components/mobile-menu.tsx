"use client";

import { useState } from "react";
import { Menu, Calendar } from "lucide-react";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetHeader,
  SheetTitle,
} from "@/shared/components/ui/sheet";
import Image from "next/image";
import Link from "next/link";
import logoImage from "@/assets/images/logo/for-dark-bg.png";
import { m, setLocale } from "@/i18n";
import { useLocale } from "@/i18n/utils/use-locale";
import { LanguageSwitcher } from "@/features/i18n";

const navigationItems = [
  { label: "nav.home", href: "/" },
  { label: "nav.boardGames", href: "/board-games" },
  { label: "nav.gallery", href: "/gallery" },
  { label: "nav.menu", href: "/menu" },
  { label: "nav.trainingRoom", href: "/training-room" },
  { label: "nav.contact", href: "/contact" },
];

export function MobileMenu() {
  const [isOpen, setIsOpen] = useState(false);
  const locale = useLocale();
  setLocale(locale, { reload: false });

  return (
    <div className="md:hidden">
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetTrigger asChild>
          <Button variant="ghost" size="icon" className="text-white hover:bg-white/10">
            <Menu className="h-6 w-6" />
            <span className="sr-only">{m["nav.openMenu"]()}</span>
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-80 bg-gray-900 border-gray-800">
          <SheetHeader className="border-b border-gray-800 pb-4">
            <div className="flex items-center gap-3">
              <Image 
                src={logoImage} 
                alt={m["altText.deskohub"]()} 
                width={40} 
                height={40} 
                className="rounded-lg" 
              />
              <SheetTitle className="text-white text-lg font-bold">Deskohub</SheetTitle>
            </div>
          </SheetHeader>

          <nav className="flex flex-col gap-2 mt-6">
            {navigationItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="flex items-center px-4 py-3 text-gray-300 hover:text-white hover:bg-gray-800 rounded-lg transition-colors duration-200 font-medium"
                onClick={() => setIsOpen(false)}
              >
                {m[item.label]()}
              </Link>
            ))}
          </nav>

          <div className="mt-8 space-y-4">
            <div className="px-4 py-3 bg-gray-800 rounded-lg">
              <h3 className="text-white font-semibold mb-2">{m["menu.openingHours.title"]()}</h3>
              <div className="text-sm text-gray-300 space-y-1">
                <div className="flex justify-between">
                  <span>{m["menu.openingHours.weekdays"]()}</span>
                  <span className="text-green-400">15:00-23:00</span>
                </div>
                <div className="flex justify-between">
                  <span>{m["menu.openingHours.weekend"]()}</span>
                  <span className="text-green-400">11:00-23:00</span>
                </div>
              </div>
            </div>

            <div className="px-4">
              <LanguageSwitcher />
            </div>

            <Link href="/reservation" className="block">
              <Button
                className="w-full bg-green-500 hover:bg-green-600 text-white font-semibold py-3 rounded-lg"
                onClick={() => setIsOpen(false)}
              >
                <Calendar className="h-4 w-4 mr-2" />
                {m["buttons.reservation"]()}
              </Button>
            </Link>
          </div>

          <div className="absolute bottom-6 left-6 right-6">
            <div className="text-center text-xs text-gray-500">
              <p>{m["footer.tagline"]()}</p>
            </div>
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}