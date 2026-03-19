"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { LanguageSwitcher, type WorkspaceLocale } from "@/features/i18n";
import { HorizontalLogo } from "@/shared/components/logo";
import { Button } from "@/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/components/ui/sheet";

type MobileMenuProps = {
  currentLocale: WorkspaceLocale;
  languageSwitcherPath: string;
  languageLabels: Record<WorkspaceLocale, string>;
  links: Array<{ label: string; href: string }>;
  contactLabel: string;
};

export function MobileMenu({
  currentLocale,
  languageSwitcherPath,
  languageLabels,
  links,
  contactLabel,
}: MobileMenuProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={setIsOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="lg:hidden text-navy-blue hover:bg-navy-blue/5"
        >
          <Menu className="h-5 w-5" />
          <span className="sr-only">Open menu</span>
        </Button>
      </SheetTrigger>

      <SheetContent side="right" className="space-y-6">
        <SheetHeader>
          <HorizontalLogo
            styling={{ color: "light", variant: "color" }}
            className="justify-start p-0"
          />
          <SheetTitle>{contactLabel}</SheetTitle>
          <SheetDescription>{languageLabels[currentLocale]}</SheetDescription>
        </SheetHeader>

        <nav aria-label="mobile" className="flex flex-col gap-2">
          {links.map((item) => (
            <Link
              key={item.label}
              href={item.href}
              className="rounded-md px-3 py-2 text-sm text-navy-blue hover:bg-silver/35"
              onClick={() => setIsOpen(false)}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <LanguageSwitcher
          currentLocale={currentLocale}
          pathname={languageSwitcherPath}
          labels={languageLabels}
        />
      </SheetContent>
    </Sheet>
  );
}
