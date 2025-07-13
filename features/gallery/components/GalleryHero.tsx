"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { m } from "@/i18n";
import { Button } from "@/shared/components/ui/button";

export function GalleryHero() {
  const heroImages = [
    {
      src: "/images/hero.jpg",
      alt: m["gallery.hero.slides.atmosphere.title"](),
      title: m["gallery.hero.slides.atmosphere.title"](),
      description: m["gallery.hero.slides.atmosphere.description"](),
    },
    {
      src: "/placeholder.svg?height=800&width=1200",
      alt: m["gallery.hero.slides.mainRoom.title"](),
      title: m["gallery.hero.slides.mainRoom.title"](),
      description: m["gallery.hero.slides.mainRoom.description"](),
    },
    {
      src: "/placeholder.svg?height=800&width=1200",
      alt: m["gallery.hero.slides.bar.title"](),
      title: m["gallery.hero.slides.bar.title"](),
      description: m["gallery.hero.slides.bar.description"](),
    },
    {
      src: "/placeholder.svg?height=800&width=1200",
      alt: m["gallery.hero.slides.trainingRoom.title"](),
      title: m["gallery.hero.slides.trainingRoom.title"](),
      description: m["gallery.hero.slides.trainingRoom.description"](),
    },
    {
      src: "/placeholder.svg?height=800&width=1200",
      alt: m["gallery.hero.slides.evening.title"](),
      title: m["gallery.hero.slides.evening.title"](),
      description: m["gallery.hero.slides.evening.description"](),
    },
  ];

  const [currentSlide, setCurrentSlide] = useState(0);
  const [isAutoPlaying, setIsAutoPlaying] = useState(true);

  // Auto-advance carousel
  useEffect(() => {
    if (!isAutoPlaying) return;

    const interval = setInterval(() => {
      setCurrentSlide((prev) => (prev + 1) % heroImages.length);
    }, 5000);

    return () => clearInterval(interval);
  }, [isAutoPlaying, heroImages.length]);

  const goToSlide = (index: number) => {
    setCurrentSlide(index);
    setIsAutoPlaying(false);
    // Resume auto-play after 10 seconds
    setTimeout(() => setIsAutoPlaying(true), 10000);
  };

  const goToPrevious = () => {
    setCurrentSlide(
      (prev) => (prev - 1 + heroImages.length) % heroImages.length
    );
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 10000);
  };

  const goToNext = () => {
    setCurrentSlide((prev) => (prev + 1) % heroImages.length);
    setIsAutoPlaying(false);
    setTimeout(() => setIsAutoPlaying(true), 10000);
  };

  return (
    <section className="relative min-h-[calc(100dvh_-_var(--header-height)_-_90px)] flex items-center justify-center overflow-hidden">
      {/* Carousel Images */}
      <div className="absolute inset-0">
        {heroImages.map((image, index) => (
          <div
            key={JSON.stringify(image)}
            className={`absolute inset-0 transition-opacity duration-1000 ${
              index === currentSlide ? "opacity-100" : "opacity-0"
            }`}
          >
            <Image
              src={image.src || "/placeholder.svg"}
              alt={image.alt}
              fill
              className="object-cover"
              priority={index === 0}
            />
            <div className="absolute inset-0 bg-black/50" />
          </div>
        ))}
      </div>

      {/* Navigation Arrows */}
      <Button
        variant="ghost"
        size="icon"
        className="absolute left-4 z-20 bg-black/30 hover:bg-black/50 text-white border-0"
        onClick={goToPrevious}
        aria-label={m["gallery.hero.previousImage"]()}
      >
        <ChevronLeft className="w-6 h-6" />
      </Button>

      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 z-20 bg-black/30 hover:bg-black/50 text-white border-0"
        onClick={goToNext}
        aria-label={m["gallery.hero.nextImage"]()}
      >
        <ChevronRight className="w-6 h-6" />
      </Button>

      {/* Content */}
      <div className="relative z-10 text-center text-white px-4 max-w-4xl mx-auto">
        <h1 className="text-5xl md:text-7xl font-bold mb-4">
          <span className="text-green-400">{m["gallery.hero.title"]()}</span>
        </h1>
        <div className="transition-all duration-500">
          <h2 className="text-2xl md:text-3xl font-semibold mb-2">
            {heroImages[currentSlide]?.title}
          </h2>
          <p className="text-lg md:text-xl opacity-90">
            {heroImages[currentSlide]?.description}
          </p>
        </div>
      </div>

      {/* Dots Indicator */}
      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20">
        <div className="flex space-x-2">
          {heroImages.map((heroImage, index) => (
            <button
              key={JSON.stringify(heroImage)}
              type="button"
              className={`w-3 h-3 rounded-full transition-all duration-300 ${
                index === currentSlide
                  ? "bg-green-400 scale-125"
                  : "bg-white/50 hover:bg-white/75"
              }`}
              onClick={() => goToSlide(index)}
              aria-label={`${m["gallery.hero.goToImage"]()} ${index + 1}`}
            />
          ))}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="absolute bottom-0 left-0 w-full h-1 bg-black/30 z-20">
        <div
          className="h-full bg-green-400 transition-all duration-300"
          style={{
            width: `${((currentSlide + 1) / heroImages.length) * 100}%`,
          }}
        />
      </div>
    </section>
  );
}
