import { z } from "zod";
export const progressSchema = z.object({
  summary: z.string().max(2000),
  product: z.string().max(1000).default(""),
  quantity: z.string().max(100).default(""),
  destination: z.string().max(200).default(""),
  waiting_on: z.enum(["我方", "客户", "第三方", "暂无"]),
  next_action: z.string().max(1500),
  conflicts: z.array(z.string().max(500)).max(10).default([]),
});
// Drafts and unknown send outcomes must never count as a completed reply.
export const progressMessageSql =
  "(direction='inbound' OR (direction='outbound' AND send_status IN ('accepted','delivered','read','synced','manual_sent','confirmed_sent'))) AND channel!='note'";
