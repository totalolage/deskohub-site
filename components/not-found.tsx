"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Home,
  Dice1,
  Dice2,
  Dice3,
  Dice4,
  Dice5,
  Dice6,
  RotateCcw,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import logoImage from "@/assets/images/logo.png";

export default function NotFoundPage() {
  const [diceRoll, setDiceRoll] = useState(4);
  const [isRolling, setIsRolling] = useState(false);

  const diceIcons = [Dice1, Dice2, Dice3, Dice4, Dice5, Dice6];
  const DiceIcon = diceIcons[diceRoll - 1];

  const rollDice = () => {
    setIsRolling(true);
    const rollAnimation = setInterval(() => {
      setDiceRoll(Math.floor(Math.random() * 6) + 1);
    }, 100);

    setTimeout(() => {
      clearInterval(rollAnimation);
      setDiceRoll(Math.floor(Math.random() * 6) + 1);
      setIsRolling(false);
    }, 1000);
  };

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
              alt="Deskohub Logo"
              width={200}
              height={80}
              className="object-contain"
            />
          </div>

          {/* Animated Dice */}
          <div className="flex justify-center">
            <div
              className={`transition-transform duration-200 ${isRolling ? "animate-spin" : "hover:scale-110"} cursor-pointer`}
              onClick={rollDice}
            >
              <DiceIcon size={80} className="text-red-500 drop-shadow-lg" />
            </div>
          </div>

          {/* 404 Message */}
          <div className="space-y-4">
            <h1 className="text-6xl font-bold text-gray-800">
              4<span className="text-red-500">0</span>4
            </h1>
            <h2 className="text-2xl font-semibold text-gray-700">
              Ups! Stránka nenalezena
            </h2>
            <p className="text-lg text-gray-600">Oops! Page not found</p>
          </div>

          {/* Fun Message */}
          <div className="bg-gradient-to-r from-red-100 to-green-100 rounded-lg p-6 space-y-3">
            <p className="text-gray-700 font-medium">
              🎲 Vypadá to, že jste hodili nesprávnou kombinací!
            </p>
            <p className="text-gray-600 text-sm">
              It looks like you rolled the wrong combination!
            </p>
            <p className="text-gray-600 text-sm">
              Zkuste to znovu nebo se vraťte na hlavní stránku pro další hru.
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
                Domů / Home
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
                className={`w-5 h-5 mr-2 ${isRolling ? "animate-spin" : ""}`}
              />
              {isRolling ? "Házím..." : "Hodit znovu / Roll Again"}
            </Button>
          </div>

          {/* Footer Message */}
          <div className="pt-6 border-t border-gray-200">
            <p className="text-sm text-gray-500">
              🎯 Připojte se k nám na další hru v Deskohub!
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Join us for another game at Deskohub!
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
