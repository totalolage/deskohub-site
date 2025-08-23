"use client";

import {
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Clock,
  Loader2,
  Send,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { getLocale } from "@/i18n";
import { Alert, AlertDescription } from "@/shared/components/ui/alert";
import { Button } from "@/shared/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/shared/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/components/ui/collapsible";
import { isDev } from "@/shared/utils/environment";

interface WebhookTestPanelProps {
  reservationId: string;
  customerId: string;
  currentStatus?: string;
}

type WebhookStatus = "created" | "confirmed" | "declined";

interface WebhookResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export function WebhookTestPanel({
  reservationId,
  customerId,
  currentStatus,
}: WebhookTestPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState<WebhookStatus | null>(null);
  const [responses, setResponses] = useState<
    Record<WebhookStatus, WebhookResponse | null>
  >({
    created: null,
    confirmed: null,
    declined: null,
  });

  // Only show in development
  if (!isDev()) {
    return null;
  }

  // In dev mode, webhook secret is not required
  const webhookUrl = `/api/webhooks/reservation`;

  const statusConfig = {
    created: {
      status: 0,
      label: "New/Created",
      icon: Clock,
      color: "text-blue-600",
      bgColor: "bg-blue-50",
      borderColor: "border-blue-200",
      description: "Sends: Customer pending email + Business notification",
    },
    confirmed: {
      status: 5,
      label: "Confirmed",
      icon: CheckCircle,
      color: "text-green-600",
      bgColor: "bg-green-50",
      borderColor: "border-green-200",
      description: "Sends: Customer confirmation email",
    },
    declined: {
      status: 10,
      label: "Declined",
      icon: XCircle,
      color: "text-red-600",
      bgColor: "bg-red-50",
      borderColor: "border-red-200",
      description: "Sends: Customer declined email",
    },
  };

  const triggerWebhook = async (type: WebhookStatus) => {
    setLoading(type);
    setResponses((prev) => ({ ...prev, [type]: null }));

    const config = statusConfig[type];

    // Create webhook payload that mimics Dotypos format
    const payload = [
      {
        branchid: 1,
        created: Date.now(),
        customerid: parseInt(customerId, 10),
        employeeid: 1,
        flags: 0,
        deleted: 0,
        note: `Test webhook trigger from dev panel\n---\nlocale: ${getLocale()}\nsource: dev-panel\ntimestamp: ${new Date().toISOString()}`,
        seats: 2,
        status: config.status,
        tableid: 1,
        taglist: null,
        versiondate: Date.now(),
        reservationid: parseInt(reservationId, 10),
        startdate: Date.now() + 86400000, // Tomorrow
        enddate: Date.now() + 90000000, // Tomorrow + 1 hour
        cloudid: `dev-test-${Date.now()}`,
      },
    ];

    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = (await response.json()) as {
        error?: string;
        [key: string]: any;
      };

      setResponses((prev) => ({
        ...prev,
        [type]: {
          success: response.ok,
          data: response.ok ? data : undefined,
          error: !response.ok
            ? data.error || `HTTP ${response.status}`
            : undefined,
        },
      }));
    } catch (error) {
      setResponses((prev) => ({
        ...prev,
        [type]: {
          success: false,
          error: error instanceof Error ? error.message : "Network error",
        },
      }));
    } finally {
      setLoading(null);
    }
  };

  return (
    <Card className="mt-8 border-dashed border-orange-300 bg-orange-50/50">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-orange-100/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-orange-600" />
                <CardTitle className="text-orange-900">
                  Development: Webhook Testing Panel
                </CardTitle>
              </div>
              {isOpen ? (
                <ChevronUp className="h-5 w-5 text-orange-600" />
              ) : (
                <ChevronDown className="h-5 w-5 text-orange-600" />
              )}
            </div>
          </CardHeader>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="space-y-4">
            <Alert className="border-orange-200 bg-orange-50">
              <AlertCircle className="h-4 w-4 text-orange-600" />
              <AlertDescription className="text-orange-900">
                <strong>Dev Mode Only:</strong> Test webhook handlers with this
                actual reservation. This will trigger real email sends using the
                Console provider.
              </AlertDescription>
            </Alert>

            <div className="space-y-2 text-sm text-gray-600">
              <p>
                <strong>Reservation ID:</strong> {reservationId}
              </p>
              <p>
                <strong>Customer ID:</strong> {customerId}
              </p>
              <p>
                <strong>Current Status:</strong> {currentStatus || "Unknown"}
              </p>
              <p>
                <strong>Webhook URL:</strong>{" "}
                <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">
                  {webhookUrl}
                </code>
              </p>
            </div>

            <div className="grid gap-4">
              {(Object.keys(statusConfig) as WebhookStatus[]).map((type) => {
                const config = statusConfig[type];
                const Icon = config.icon;
                const response = responses[type];
                const isLoading = loading === type;

                return (
                  <div
                    key={type}
                    className={`p-4 rounded-lg border-2 ${config.borderColor} ${config.bgColor}`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <Icon className={`h-5 w-5 ${config.color}`} />
                        <h3 className={`font-semibold ${config.color}`}>
                          {config.label} (Status: {config.status})
                        </h3>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => triggerWebhook(type)}
                        disabled={isLoading}
                        className="min-w-[100px]"
                      >
                        {isLoading ? (
                          <>
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            Sending...
                          </>
                        ) : (
                          <>
                            <Send className="mr-2 h-4 w-4" />
                            Trigger
                          </>
                        )}
                      </Button>
                    </div>

                    <p className="text-sm text-gray-600 mb-3">
                      {config.description}
                    </p>

                    {response && (
                      <div
                        className={`mt-3 p-3 rounded ${
                          response.success
                            ? "bg-green-100 border border-green-300"
                            : "bg-red-100 border border-red-300"
                        }`}
                      >
                        <div className="flex items-center gap-2 mb-1">
                          {response.success ? (
                            <>
                              <CheckCircle className="h-4 w-4 text-green-600" />
                              <span className="text-sm font-medium text-green-800">
                                Success
                              </span>
                            </>
                          ) : (
                            <>
                              <XCircle className="h-4 w-4 text-red-600" />
                              <span className="text-sm font-medium text-red-800">
                                Failed
                              </span>
                            </>
                          )}
                        </div>
                        {response.error && (
                          <p className="text-sm text-red-700">
                            Error: {response.error}
                          </p>
                        )}
                        {response.data && (
                          <details className="mt-2">
                            <summary className="text-sm text-gray-600 cursor-pointer hover:text-gray-800">
                              View Response
                            </summary>
                            <pre className="mt-2 text-xs bg-white p-2 rounded overflow-x-auto">
                              {JSON.stringify(response.data, null, 2)}
                            </pre>
                          </details>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            <Alert className="border-gray-200">
              <AlertDescription className="text-sm text-gray-600">
                <strong>Note:</strong> These webhooks will fetch the actual
                reservation data from Dotypos and send real emails. Check the
                server console for email output.
              </AlertDescription>
            </Alert>
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
