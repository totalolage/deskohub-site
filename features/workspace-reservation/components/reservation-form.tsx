"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  type ReservationFormData,
  reservationSchema,
  workspaceConstants,
} from "../schemas/reservation";

export function ReservationForm() {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ReservationFormData>({
    resolver: zodResolver(reservationSchema),
    defaultValues: workspaceConstants.defaultValues,
  });

  async function onSubmit(values: ReservationFormData) {
    setIsSubmitting(true);
    try {
      // TODO: Implement API call to submit reservation
      console.log("Form submitted:", values);

      // Simulate API call delay
      await new Promise((resolve) => setTimeout(resolve, 1000));

      // Show success message
      toast.success("Reservation submitted successfully!", {
        description: "We'll send you a confirmation email shortly.",
      });

      // Reset form after successful submission
      form.reset();
    } catch (error) {
      // Handle error
      console.error("Error submitting form:", error);
      toast.error("Failed to submit reservation", {
        description:
          error instanceof Error ? error.message : "Please try again later.",
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="reservation-form-container max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold mb-6">Make a Reservation</h2>

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          {/* User Information Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Your Information</h3>

            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel htmlFor="name">Full Name</FormLabel>
                  <FormControl>
                    <Input
                      id="name"
                      placeholder="John Doe"
                      aria-label="Full Name"
                      aria-describedby="name-error"
                      aria-required="true"
                      {...field}
                    />
                  </FormControl>
                  <FormMessage id="name-error" />
                </FormItem>
              )}
            />

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="email">Email</FormLabel>
                    <FormControl>
                      <Input
                        id="email"
                        type="email"
                        placeholder="your@email.com"
                        aria-label="Email"
                        aria-describedby="email-error"
                        aria-required="true"
                        autoComplete="email"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="email-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="phone">Phone Number</FormLabel>
                    <FormControl>
                      <Input
                        id="phone"
                        type="tel"
                        placeholder="+1234567890"
                        aria-label="Phone Number"
                        aria-describedby="phone-error"
                        aria-required="true"
                        autoComplete="tel"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage id="phone-error" />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Reservation Details Section */}
          <div className="space-y-4">
            <h3 className="text-lg font-medium">Reservation Details</h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="date"
                render={({ field }) => (
                  <FormItem className="flex flex-col">
                    <FormLabel htmlFor="date-button">Date</FormLabel>
                    <Popover>
                      <PopoverTrigger asChild>
                        <FormControl>
                          <Button
                            id="date-button"
                            variant="outline"
                            className={cn(
                              "w-full pl-3 text-left font-normal",
                              !field.value && "text-muted-foreground"
                            )}
                            aria-label="Select date"
                            aria-describedby="date-error"
                            aria-required="true"
                            aria-haspopup="dialog"
                            aria-expanded={false}
                          >
                            {field.value ? (
                              format(field.value, "PPP")
                            ) : (
                              <span>Pick a date</span>
                            )}
                            <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                          </Button>
                        </FormControl>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={field.value}
                          onSelect={field.onChange}
                          disabled={(date) => {
                            const today = new Date();
                            today.setHours(0, 0, 0, 0);
                            return date < today;
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <FormMessage id="date-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="time"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="time-select">Time</FormLabel>
                    <Select
                      onValueChange={field.onChange}
                      defaultValue={field.value}
                    >
                      <FormControl>
                        <SelectTrigger
                          id="time-select"
                          aria-label="Select time"
                          aria-describedby="time-error"
                          aria-required="true"
                        >
                          <SelectValue placeholder="Select a time" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {/* Generate time slots from 8:00 AM to 6:00 PM */}
                        {Array.from({ length: 11 }, (_, i) => {
                          const hour = i + 8;
                          const time = `${hour.toString().padStart(2, "0")}:00`;
                          const displayTime = `${
                            hour > 12 ? hour - 12 : hour
                          }:00 ${hour >= 12 ? "PM" : "AM"}`;
                          return (
                            <SelectItem key={time} value={time}>
                              {displayTime}
                            </SelectItem>
                          );
                        })}
                      </SelectContent>
                    </Select>
                    <FormMessage id="time-error" />
                  </FormItem>
                )}
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="duration"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="duration-select">
                      Duration (hours)
                    </FormLabel>
                    <Select
                      value={field.value?.toString()}
                      onValueChange={(value) => field.onChange(parseInt(value))}
                    >
                      <FormControl>
                        <SelectTrigger
                          id="duration-select"
                          aria-label="Select duration"
                          aria-describedby="duration-error"
                          aria-required="true"
                        >
                          <SelectValue placeholder="Select duration" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map((hours) => (
                          <SelectItem key={hours} value={hours.toString()}>
                            {hours} {hours === 1 ? "hour" : "hours"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage id="duration-error" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="spaceType"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel htmlFor="space-type-select">
                      Desk/Space Type
                    </FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger
                          id="space-type-select"
                          aria-label="Select desk or space type"
                          aria-describedby="space-type-error"
                          aria-required="true"
                        >
                          <SelectValue placeholder="Select space type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="standard">Standard Desk</SelectItem>
                        <SelectItem value="premium">Premium Desk</SelectItem>
                        <SelectItem value="meeting_small">
                          Small Meeting Room
                        </SelectItem>
                        <SelectItem value="meeting_large">
                          Large Meeting Room
                        </SelectItem>
                        <SelectItem value="private_office">
                          Private Office
                        </SelectItem>
                      </SelectContent>
                    </Select>
                    <FormMessage id="space-type-error" />
                  </FormItem>
                )}
              />
            </div>
          </div>

          {/* Special Requirements Section */}
          <FormField
            control={form.control}
            name="specialRequirements"
            render={({ field }) => (
              <FormItem>
                <FormLabel htmlFor="special-requirements">
                  Special Requirements
                </FormLabel>
                <FormControl>
                  <Textarea
                    id="special-requirements"
                    placeholder="Any special requirements or notes for your reservation..."
                    className="min-h-[100px]"
                    aria-label="Special requirements"
                    aria-describedby="special-requirements-error special-requirements-count"
                    maxLength={
                      workspaceConstants.validation.specialRequirements.max
                    }
                    {...field}
                  />
                </FormControl>
                <div className="flex justify-between">
                  <FormMessage id="special-requirements-error" />
                  <span
                    id="special-requirements-count"
                    className="text-sm text-muted-foreground"
                    aria-live="polite"
                  >
                    {field.value?.length || 0}/
                    {workspaceConstants.validation.specialRequirements.max}
                  </span>
                </div>
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
            aria-busy={isSubmitting}
          >
            {isSubmitting ? "Submitting..." : "Complete Reservation"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
