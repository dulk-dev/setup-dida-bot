import type { WebhookAuthStyle } from "./config.ts";

export interface MergeSummaryItem {
  fragmentId: string;
  contextId: string;
  fragmentTitle: string;
  contextTitle: string;
  createdSecond: string;
}

export type PendingReason = "merged" | "standalone";

export interface PendingBotItem {
  taskId: string;
  projectId: string;
  title: string;
  reason: PendingReason;
  tags?: string[];
  /** After successful claim path: lifecycle leaf (e.g. doing). */
  lifecycle?: string;
}

/** Wake payload. source is always setup-dida-bot. */
export interface WorkWebhookPayload {
  event: "dida_bot_work";
  source: "setup-dida-bot";
  mergedCount: number;
  merges: MergeSummaryItem[];
  pending: PendingBotItem[];
}

export interface ExpiryWebhookPayload {
  event: "dida_token_expiry_reminder";
  source: "setup-dida-bot";
  expiresAt: string;
  daysRemaining: number;
  shanghaiDate: string;
}

export function parseWebhookAuthStyle(
  raw: string | undefined,
): WebhookAuthStyle {
  const value = (raw ?? "both").trim().toLowerCase();
  if (value === "bearer" || value === "header" || value === "both") return value;
  return "both";
}

export function webhookHeaders(
  secret: string,
  style: WebhookAuthStyle,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (style === "bearer" || style === "both") {
    headers.Authorization = `Bearer ${secret}`;
  }
  if (style === "header" || style === "both") {
    headers["X-Webhook-Secret"] = secret;
  }
  // Cursor / Grok Bot automations also accept this header (make-bot-ui).
  headers["X-Automation-Key"] = secret;
  return headers;
}

export async function postWebhook(
  url: string,
  secret: string,
  style: WebhookAuthStyle,
  payload: WorkWebhookPayload | ExpiryWebhookPayload,
): Promise<{ ok: boolean; status: number }> {
  const response = await fetch(url, {
    method: "POST",
    headers: webhookHeaders(secret, style),
    body: JSON.stringify(payload),
  });
  return { ok: response.ok, status: response.status };
}
