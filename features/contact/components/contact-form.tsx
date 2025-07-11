"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Send } from "lucide-react";
import { useAction } from "next-safe-action/hooks";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { submitContactForm } from "@/features/contact/actions/contact";
import {
  type ContactData,
  type ContactFormData,
  contactDefaultValues,
  getContactSchema,
} from "@/features/contact/schemas/contact";
import { m } from "@/i18n";
import { cn } from "@/shared/utils";

export function ContactForm() {
  const form = useForm<ContactFormData, unknown, ContactData>({
    resolver: zodResolver(getContactSchema()),
    defaultValues: contactDefaultValues,
    mode: "onChange",
  });

  const { execute, isExecuting } = useAction(submitContactForm, {
    onSuccess: () => {
      toast.success(m["contact.successMessage"]());
      form.reset();
    },
    onError: ({ error }) => {
      toast.error(error.serverError || m["errors.submissionError"]());
    },
  });

  const handleSubmit = form.handleSubmit((data) => {
    execute(data);
  });

  return (
    <Card className="bg-gray-900 border-gray-700">
      <CardHeader>
        <CardTitle className="text-2xl font-bold text-white">
          {m["contact.formTitle"]()}
        </CardTitle>
        <p className="text-gray-300">{m["contact.formDescription"]()}</p>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">
                      {m["contact.nameLabel"]()} *
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="text"
                        className={cn(
                          "bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400",
                          form.formState.errors.name && "border-red-500",
                        )}
                        placeholder={m["contact.namePlaceholder"]()}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="phone"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-gray-300">
                      {m["contact.phoneFormLabel"]()}
                    </FormLabel>
                    <FormControl>
                      <Input
                        {...field}
                        type="tel"
                        className="bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400"
                        placeholder={m["contact.phonePlaceholder"]()}
                      />
                    </FormControl>
                    <FormMessage className="text-red-400" />
                  </FormItem>
                )}
              />
            </div>

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    {m["contact.emailFormLabel"]()} *
                  </FormLabel>
                  <FormControl>
                    <Input
                      {...field}
                      type="email"
                      className={cn(
                        "bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400",
                        form.formState.errors.email && "border-red-500",
                      )}
                      placeholder={m["contact.emailPlaceholder"]()}
                    />
                  </FormControl>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="message"
              render={({ field }) => (
                <FormItem>
                  <FormLabel className="text-gray-300">
                    {m["contact.messageLabel"]()} *
                  </FormLabel>
                  <FormControl>
                    <Textarea
                      {...field}
                      rows={5}
                      className={cn(
                        "bg-gray-800 border-gray-600 text-white placeholder-gray-400 focus:border-green-400",
                        form.formState.errors.message && "border-red-500",
                      )}
                      placeholder={m["contact.messagePlaceholder"]()}
                    />
                  </FormControl>
                  <FormMessage className="text-red-400" />
                </FormItem>
              )}
            />

            <Button
              type="submit"
              className="w-full bg-green-500 hover:bg-green-600 text-white py-3 text-lg font-semibold"
            >
              {isExecuting ? (
                <>
                  <span className="animate-spin mr-2">⏳</span>
                  {m["booking.submitting"]()}
                </>
              ) : (
                <>
                  <Send className="w-5 h-5 mr-2" />
                  {m["contact.submitButton"]()}
                </>
              )}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}
