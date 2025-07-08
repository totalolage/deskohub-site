"use client";

import type React from "react";
import { useFormStatus } from "react-dom";
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
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Badge } from "@/components/ui/badge";
import { m } from "@/i18n";

interface BookingFormProps {
  formAction: (formData: FormData) => void;
  isPending: boolean;
  errors: Record<string, string>;
}

function SubmitButton() {
  const { pending } = useFormStatus();
  
  return (
    <Button
      type="submit"
      size="lg"
      className="bg-green-500 hover:bg-green-600 text-white px-8 py-3 text-lg w-full"
      disabled={pending}
    >
      {pending ? m["booking.submitting"]() : m["booking.submit"]()}
    </Button>
  );
}

export function BookingForm({ formAction, isPending, errors }: BookingFormProps) {
  const timeSlots = {
    weekday: [
      "17:00", "17:30", "18:00", "18:30", "19:00", "19:30", 
      "20:00", "20:30", "21:00", "21:30", "22:00",
    ],
    weekend: [
      "15:00", "15:30", "16:00", "16:30", "17:00", "17:30",
      "18:00", "18:30", "19:00", "19:30", "20:00", "20:30",
      "21:00", "21:30", "22:00", "22:30", "23:00",
    ],
  };

  const getFieldError = (fieldName: string) => {
    return errors[fieldName];
  };

  return (
    <div className="space-y-6">
      {/* Operating Hours */}
      <div className="flex justify-center gap-4 mb-6">
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekdays"]()} {m["hours.weekdaysTime"]()}
        </Badge>
        <Badge variant="outline" className="px-4 py-2">
          <Clock className="w-4 h-4 mr-2" />
          {m["hours.weekends"]()} {m["hours.weekendsTime"]()}
        </Badge>
      </div>

      <form action={formAction} className="space-y-6">
        <div className="grid md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="w-5 h-5 text-green-500" />
                {m["booking.dateLabel"]()} & {m["booking.timeLabel"]()}
              </CardTitle>
              <CardDescription>
                Choose your preferred date and time
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="date">{m["booking.dateLabel"]()}</Label>
                <Input
                  id="date"
                  name="date"
                  type="date"
                  min={new Date().toISOString().split("T")[0]}
                  required
                />
                {getFieldError("date") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("date")}</p>
                )}
              </div>

              <div>
                <Label htmlFor="time">{m["booking.timeLabel"]()}</Label>
                <Select name="time" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Select time" />
                  </SelectTrigger>
                  <SelectContent>
                    {timeSlots.weekend.map((time) => (
                      <SelectItem key={time} value={time}>
                        {time}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {getFieldError("time") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("time")}</p>
                )}
              </div>

              <div>
                <Label htmlFor="guestCount">{m["booking.guestCountLabel"]()}</Label>
                <Select name="guestCount" required>
                  <SelectTrigger>
                    <SelectValue placeholder="Number of guests" />
                  </SelectTrigger>
                  <SelectContent>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <SelectItem key={num} value={num.toString()}>
                        {num} {num === 1 ? "person" : "people"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {getFieldError("guestCount") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("guestCount")}</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Contact Information */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Phone className="w-5 h-5 text-green-500" />
                Contact Information
              </CardTitle>
              <CardDescription>
                Your contact details for booking confirmation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor="name">{m["booking.nameLabel"]()}</Label>
                <Input 
                  id="name"
                  name="name"
                  placeholder="John Doe"
                  required
                />
                {getFieldError("name") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("name")}</p>
                )}
              </div>

              <div>
                <Label htmlFor="email">{m["booking.emailLabel"]()}</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="john@example.com"
                  required
                />
                {getFieldError("email") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("email")}</p>
                )}
              </div>

              <div>
                <Label htmlFor="phone">{m["booking.phoneLabel"]()}</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  placeholder="+420 123 456 789"
                  required
                />
                {getFieldError("phone") && (
                  <p className="text-sm text-red-600 mt-1">{getFieldError("phone")}</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Table Preferences */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Gamepad2 className="w-5 h-5 text-green-500" />
              {m["booking.tablePreferenceLabel"]()}
            </CardTitle>
            <CardDescription>
              Choose the type of table that suits your needs
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RadioGroup name="tablePreference">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="standard" id="standard" />
                <Label htmlFor="standard">{m["booking.tablePreferences.standard"]()}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="large" id="large" />
                <Label htmlFor="large">{m["booking.tablePreferences.large"]()}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="private" id="private" />
                <Label htmlFor="private">{m["booking.tablePreferences.private"]()}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="any" id="any" />
                <Label htmlFor="any">{m["booking.tablePreferences.any"]()}</Label>
              </div>
            </RadioGroup>
          </CardContent>
        </Card>

        {/* Pre-orders */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Utensils className="w-5 h-5 text-green-500" />
              {m["booking.preOrdersLabel"]()}
            </CardTitle>
            <CardDescription>
              Would you like to pre-order food or drinks?
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="preOrders">{m["booking.preOrderDetailsPlaceholder"]()}</Label>
              <Textarea
                id="preOrders"
                name="preOrders"
                placeholder={m["booking.preOrderDetailsPlaceholder"]()}
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Special Requests */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-green-500" />
              {m["booking.specialRequestsLabel"]()}
            </CardTitle>
            <CardDescription>
              Any special requests or notes?
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              name="specialRequests"
              placeholder={m["booking.specialRequestsPlaceholder"]()}
              rows={4}
            />
          </CardContent>
        </Card>

        {/* Pricing Info */}
        <Card className="bg-green-50 border-green-200">
          <CardContent className="pt-6">
            <div className="text-center space-y-2">
              <h3 className="font-semibold text-green-800">
                {m["booking.pricingInfo"]()}
              </h3>
            </div>
          </CardContent>
        </Card>

        {/* Submit Button */}
        <div className="text-center">
          <SubmitButton />
          <p className="text-sm text-gray-500 mt-2">
            We'll confirm your booking within 24 hours
          </p>
        </div>
      </form>
    </div>
  );
}