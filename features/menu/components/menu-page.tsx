"use client";

import { Download } from "lucide-react";
import heroImage from "@/assets/images/hero.jpg";
import { m } from "@/i18n";
import { Hero } from "@/shared/components";
import { Button } from "@/shared/components/ui/button";
import { generateMenuPDF } from "../actions/pdf-generator";
import { drinkMenu, foodMenu } from "../menu-data";
import { MenuSectionComponent } from "./menu-section";

export function MenuPage() {
  return (
    <>
      {/* Hero Section */}
      <Hero imageSrc={heroImage}>
        <div className="relative z-10 text-center">
          <h1 className="text-5xl md:text-7xl font-bold text-green-400 mb-4">
            {m["menu.hero.title"]()}
          </h1>
          <p className="text-xl text-white max-w-2xl mx-auto px-4">
            {m["menu.hero.subtitle"]()}
          </p>
        </div>
      </Hero>

      {/* Menu Content */}
      <div className="max-w-4xl mx-auto px-6 py-16">
        {/* PDF Download Button */}
        <div className="text-center mb-12">
          <Button
            onClick={generateMenuPDF}
            className="bg-green-500 hover:bg-green-600 text-black font-semibold px-8 py-3 text-lg"
          >
            <Download className="mr-2 h-5 w-5" />
            {m["menu.downloadPDF"]()}
          </Button>
        </div>

        {/* Opening Hours */}
        <div className="text-center mb-16">
          <div className="inline-flex bg-black/60 backdrop-blur-sm rounded-lg p-6 border border-green-400/20">
            <div className="text-center mr-8">
              <div className="text-green-400 font-semibold mb-2">
                {m["menu.openingHours.weekdays"]()}
              </div>
              <div className="text-white text-xl">
                {m["menu.openingHours.weekdaysTime"]()}
              </div>
            </div>
            <div className="text-center">
              <div className="text-green-400 font-semibold mb-2">
                {m["menu.openingHours.weekend"]()}
              </div>
              <div className="text-white text-xl">
                {m["menu.openingHours.weekendTime"]()}
              </div>
            </div>
          </div>
        </div>

        {/* Food Menu */}
        <div className="mb-16">
          <h1 className="text-4xl font-bold text-center text-white mb-12">
            🍽️ {m["menu.sections.food"]()}
          </h1>
          {foodMenu.map((section) => (
            <MenuSectionComponent key={section.title} section={section} />
          ))}
        </div>

        {/* Drinks Menu */}
        <div>
          <h1 className="text-4xl font-bold text-center text-white mb-12">
            🥤 {m["menu.sections.drinks"]()}
          </h1>
          {drinkMenu.map((section) => (
            <MenuSectionComponent key={section.title} section={section} />
          ))}
        </div>

        {/* Footer Note */}
        <div className="text-center mt-16 p-6 bg-black/40 backdrop-blur-sm rounded-lg border border-green-400/20">
          <p className="text-gray-300">{m["menu.footerNote"]()}</p>
        </div>
      </div>
    </>
  );
}
