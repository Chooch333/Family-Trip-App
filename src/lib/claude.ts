import { supabase } from "./supabase";
import type { Trip, Day, Stop } from "./database.types";

interface AskClaudeParams {
  tripId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  systemContext?: string;
}

interface ToolCall {
  name: string;
  id: string;
  input: Record<string, unknown>;
}

export interface AskClaudeResult {
  text: string;
  toolCalls: ToolCall[];
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYER 1 — PERSONALITY
// This is who Claude IS in this app. It never changes. It anchors every
// response regardless of trip, day, or tool call. Everything else is context
// layered on top of this identity.
// ─────────────────────────────────────────────────────────────────────────────

const CO_PILOT_PERSONALITY = `You are this trip's Co-Pilot — the friend who's already been everywhere