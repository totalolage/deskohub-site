"use client";

import type React from "react";

import { useState } from "react";
import {
  Calendar,
  Clock,
  Phone,
  MessageSquare,
  Utensils,
  Gamepad2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import Image from "next/image";

export default function BookingForm() {
  const [selectedDate, setSelectedDate] = useState("");
  const [selectedTime, setSelectedTime] = useState("");
  const [guestCount, setGuestCount] = useState("");
  const [tablePreference, setTablePreference] = useState("");
  const [preOrderFood, setPreOrderFood] = useState(false);
  const [preOrderDrinks, setPreOrderDrinks] = useState(false);

  const timeSlots = {
    weekday: [
      "17:00",
      "17:30",
      "18:00",
      "18:30",
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
      "22:00",
    ],
    weekend: [
      "15:00",
      "15:30",
      "16:00",
      "16:30",
      "17:00",
      "17:30",
      "18:00",
      "18:30",
      "19:00",
      "19:30",
      "20:00",
      "20:30",
      "21:00",
      "21:30",
      "22:00",
      "22:30",
      "23:00",
    ],
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Handle form submission
    console.log("Booking submitted");
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100">
      {/* Header */}
      <header className="bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center space-x-3">
              <Image src="/logo.png" alt="Deskohub" width={40} height={40} />
              <span className="text-xl font-bold">
                <span className="text-red-500">Desko</span>
                <span className="text-green-500">hub</span>
              </span>
            </div>
            <nav className="hidden md:flex space-x-8 text-sm font-medium text-gray-700">
              <a href="#" className="hover:text-green-500">
                DOMŮ
              </a>
              <a href="#" className="hover:text-green-500">
                DESKOVÉ HRY
              </a>
              <a href="#" className="hover:text-green-500">
                GALERIE
              </a>
              <a href="#" className="hover:text-green-500">
                MENU
              </a>
              <a href="#" className="hover:text-green-500">
                KONTAKT
              </a>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Hero Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4">
            <span className="text-green-500">Rezervace</span>
          </h1>
          <p className="text-gray-600 max-w-2xl mx-auto">
            Rezervujte si stůl v našem herním centru. Hrejte, pijte, jezte vše
            na jednom místě!
          </p>

          {/* Operating Hours */}
          <div className="flex justify-center gap-4 mt-6">
            <Badge variant="outline" className="px-4 py-2">
              <Clock className="w-4 h-4 mr-2" />
              PO - PÁ: 17:00-23:00
            </Badge>
            <Badge variant="outline" className="px-4 py-2">
              <Clock className="w-4 h-4 mr-2" />
              SO - NE: 15:00-24:00
            </Badge>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-green-500" />
                  Základní informace
                </CardTitle>
                <CardDescription>
                  Vyberte datum, čas a počet hostů
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="date">Datum rezervace</Label>
                  <Input
                    id="date"
                    type="date"
                    value={selectedDate}
                    onChange={(e) => setSelectedDate(e.target.value)}
                    min={new Date().toISOString().split("T")[0]}
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="time">Čas</Label>
                  <Select
                    value={selectedTime}
                    onValueChange={setSelectedTime}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Vyberte čas" />
                    </SelectTrigger>
                    <SelectContent>
                      {timeSlots.weekend.map((time) => (
                        <SelectItem key={time} value={time}>
                          {time}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div>
                  <Label htmlFor="guests">Počet hostů</Label>
                  <Select
                    value={guestCount}
                    onValueChange={setGuestCount}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Počet osob" />
                    </SelectTrigger>
                    <SelectContent>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                        <SelectItem key={num} value={num.toString()}>
                          {num}{" "}
                          {num === 1 ? "osoba" : num < 5 ? "osoby" : "osob"}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>

            {/* Contact Information */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="w-5 h-5 text-green-500" />
                  Kontaktní údaje
                </CardTitle>
                <CardDescription>
                  Vaše kontaktní informace pro potvrzení rezervace
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label htmlFor="name">Jméno a příjmení</Label>
                  <Input id="name" placeholder="Jan Novák" required />
                </div>

                <div>
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="jan@example.com"
                    required
                  />
                </div>

                <div>
                  <Label htmlFor="phone">Telefon</Label>
                  <Input
                    id="phone"
                    type="tel"
                    placeholder="+420 123 456 789"
                    required
                  />
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Table Preferences */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Gamepad2 className="w-5 h-5 text-green-500" />
                Preference stolu
              </CardTitle>
              <CardDescription>
                Vyberte typ stolu podle vašich potřeb
              </CardDescription>
            </CardHeader>
            <CardContent>
              <RadioGroup
                value={tablePreference}
                onValueChange={setTablePreference}
              >
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="standard" id="standard" />
                  <Label htmlFor="standard">Standardní stůl (4-6 osob)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="large" id="large" />
                  <Label htmlFor="large">Velký stůl (6-10 osob)</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="private" id="private" />
                  <Label htmlFor="private">Soukromý koutek</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="any" id="any" />
                  <Label htmlFor="any">Jakýkoliv dostupný stůl</Label>
                </div>
              </RadioGroup>
            </CardContent>
          </Card>

          {/* Pre-orders */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Utensils className="w-5 h-5 text-green-500" />
                Předobjednávka
              </CardTitle>
              <CardDescription>
                Chcete si předobjednat jídlo nebo nápoje?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="preorder-food"
                  checked={preOrderFood}
                  onCheckedChange={setPreOrderFood}
                />
                <Label htmlFor="preorder-food">Chci předobjednat jídlo</Label>
              </div>

              <div className="flex items-center space-x-2">
                <Checkbox
                  id="preorder-drinks"
                  checked={preOrderDrinks}
                  onCheckedChange={setPreOrderDrinks}
                />
                <Label htmlFor="preorder-drinks">
                  Chci předobjednat nápoje
                </Label>
              </div>

              {(preOrderFood || preOrderDrinks) && (
                <div>
                  <Label htmlFor="preorder-details">
                    Detaily předobjednávky
                  </Label>
                  <Textarea
                    id="preorder-details"
                    placeholder="Uveďte, co si přejete předobjednat..."
                    rows={3}
                  />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Special Requests */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-green-500" />
                Speciální požadavky
              </CardTitle>
              <CardDescription>
                Máte nějaké speciální požadavky nebo poznámky?
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Textarea
                placeholder="Narozeniny, alergeny, specifické hry, nebo jiné požadavky..."
                rows={4}
              />
            </CardContent>
          </Card>

          {/* Pricing Info */}
          <Card className="bg-green-50 border-green-200">
            <CardContent className="pt-6">
              <div className="text-center space-y-2">
                <h3 className="font-semibold text-green-800">
                  Vstupné pro hráče deskových her
                </h3>
                <div className="flex justify-center gap-8 text-sm">
                  <div>
                    <span className="font-bold text-green-600">50 Kč</span>
                    <span className="text-green-700"> - při objednávce</span>
                  </div>
                  <div>
                    <span className="font-bold text-green-600">100 Kč</span>
                    <span className="text-green-700"> - bez konzumace</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Submit Button */}
          <div className="text-center">
            <Button
              type="submit"
              size="lg"
              className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 text-lg"
            >
              Odeslat rezervaci
            </Button>
            <p className="text-sm text-gray-500 mt-2">
              Rezervaci potvrdíme do 24 hodin emailem nebo telefonicky
            </p>
          </div>
        </form>
      </div>
    </div>
  );
}
