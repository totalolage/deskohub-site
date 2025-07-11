import type { Metadata } from "next";
import {
  ContactForm,
  ContactHero,
  ContactInfo,
  ContactMap,
} from "@/features/contact";
import { m } from "@/i18n";

export const metadata: Metadata = {
  title: `${m["contact.heroTitle"]()} | Deskohub`,
  description: m["contact.heroSubtitle"](),
};

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-black">
      <ContactHero />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          <ContactInfo />
          <ContactForm />
        </div>

        <ContactMap />
      </div>
    </div>
  );
}
