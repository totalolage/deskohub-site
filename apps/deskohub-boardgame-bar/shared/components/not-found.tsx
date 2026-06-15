"use client";

import {
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  Home,
  RotateCcw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useEffectEvent, useState } from "react";
import logoImage from "@/assets/images/logo/for-light-bg.png";
import { m, setLocale } from "@/features/i18n";
import { useLocale } from "@/features/i18n/utils/use-locale";
import { Button } from "@/shared/components/ui/button";
import { Card, CardContent } from "@/shared/components/ui/card";
import { cn } from "@/shared/utils";

export function NotFound() {
  setLocale(useLocale(), { reload: false });

  const [diceRoll, setDiceRoll] = useState(4);
  const [isRolling, setIsRolling] = useState(false);

  const diceIcons = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
  const DiceIcon = diceIcons[diceRoll - 1] ?? Dice4;

  const rollDice = useEffectEvent(() => {
    setIsRolling(true);
    const rollAnimation = setInterval(() => {
      setDiceRoll(Math.floor(Math.random() * 6) + 1);
    }, 100);

    setTimeout(() => {
      clearInterval(rollAnimation);
      setDiceRoll(Math.floor(Math.random() * 6) + 1);
      setIsRolling(false);
    }, 1000);
  });

  useEffect(() => {
    // Auto-roll dice on page load
    const timer = setTimeout(() => {
      rollDice();
    }, 500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-[calc(100dvh-var(--header-height))] bg-gradient-to-br from-orange-50 to-red-50 flex items-center justify-center p-4 relative">
      <Card className="w-full max-w-2xl mx-auto shadow-2xl border-0 bg-white/95 backdrop-blur">
        <CardContent className="p-8 text-center space-y-8">
          <div className="flex justify-center">
            <Image
              src={logoImage}
              alt={m["altText.deskohub"]()}
              width={200}
              height={80}
              className="object-contain"
              priority
            />
          </div>

          {/* Animated Dice */}
          <div className="flex justify-center">
            <button
              type="button"
              className={cn(
                "transition-transform duration-200 cursor-pointer bg-transparent border-none p-0",
                isRolling ? "animate-spin" : "hover:scale-110"
              )}
              onClick={rollDice}
              aria-label="Roll dice for a random suggestion"
            >
              <DiceIcon size={80} className="text-red-500 drop-shadow-lg" />
            </button>
          </div>

          {/* 404 Message */}
          <div className="space-y-4">
            <h1 className="text-6xl font-bold text-gray-800">
              4<span className="text-red-500">0</span>4
            </h1>
            <h2 className="text-2xl font-semibold text-gray-700">
              {m["notFound.title"]()}
            </h2>
          </div>

          {/* Fun Message */}
          <div className="bg-gradient-to-r from-red-100 to-green-100 rounded-lg p-6 space-y-3">
            <p className="text-gray-700 font-medium">
              🎲 {m["notFound.subtitle"]()}
            </p>
            <p className="text-gray-600 text-sm">
              {m["notFound.description"]()}
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center">
            <Button
              asChild
              size="lg"
              className="bg-red-500 hover:bg-red-600 text-white px-8 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-200"
            >
              <Link href="/">
                <Home className="w-5 h-5 mr-2" />
                {m["notFound.homeButton"]()}
              </Link>
            </Button>

            <Button
              onClick={rollDice}
              variant="outline"
              size="lg"
              disabled={isRolling}
              className="border-2 border-green-500 text-green-600 hover:bg-green-50 px-8 py-3 rounded-full shadow-lg hover:shadow-xl transition-all duration-200 bg-transparent"
            >
              <RotateCcw
                className={cn("w-5 h-5 mr-2", isRolling && "animate-spin")}
              />
              {isRolling
                ? m["notFound.rollingText"]()
                : m["notFound.rollAgainButton"]()}
            </Button>
          </div>

          {/* Footer Message */}
          <div className="pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              🎯 {m["notFound.footerMessage"]()}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Floating Game Pieces Animation */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute top-20 left-10 text-red-400 opacity-20 animate-bounce">
          <Dice3 size={24} />
        </div>
        <div className="absolute top-40 right-20 text-green-400 opacity-20 animate-bounce delay-300">
          <Dice5 size={32} />
        </div>
        <div className="absolute bottom-32 left-20 text-orange-400 opacity-20 animate-bounce delay-700">
          <Dice2 size={28} />
        </div>
        <div className="absolute bottom-20 right-10 text-blue-400 opacity-20 animate-bounce delay-500">
          <Dice6 size={20} />
        </div>
      </div>
    </div>
  );
}
