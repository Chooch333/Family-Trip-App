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

const TOOLS = [
  {
    name: "replace_stop",
    description: "Replace a specific stop in the itinerary with a new one. Use this when the user wants to swap an activity, meal, or experience for something different. Keeps the rest of the day exactly as-is.",
    input_schema: {
      type: "object",
      properties: {
        stop_id: { type: "string", description: "UUID of the existing stop to replace" },
        new_stop: {
          type: "object",
          properties: {
            name: { type: "string", description: "Name of the new stop" },
            description: { type: "string", description: "Why this stop fits — written for this specific group. Recommendation-style, 1-2 sentences." },
            stop_type: { type: "string", enum: ["food", "visit", "walking", "experience", "transit"], description: "Type of stop" },
            duration_minutes: { type: "integer", description: "Estimated duration in minutes" },
            latitude: { type: "number", description: "Latitude coordinate" },
            longitude: { type: "number", description: "Longitude coordinate" },
            cost_estimate: { type: "number", description: "Estimated cost per person in local currency" },
            cost_currency: { type: "string", description: "Currency code e.g. EUR, USD" },
          },
          required: ["name", "description", "stop_type", "duration_minutes"],
        },
      },
      required: ["stop_id", "new_stop"],
    },
  },
  {
    name: "add_stop",
    description: "Add a new stop to a day's itinerary at a specific position. Use when the user wants to add something to the day without removing anything.",
    input_schema: {
      type: "object",
      properties: {
        day_id: { type: "string", description: "UUID of the day to add the stop to" },
        sort_order: { type: "integer", description: "Position in the day (0-indexed). Other stops shift down." },
        new_stop: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            stop_type: { type: "string", enum: ["food", "visit", "walking", "experience", "transit"] },
            duration_minutes: { type: "integer" },
            latitude: { type: "number" },
            longitude: { type: "number" },
            cost_estimate: { type: "number" },
            cost_currency: { type: "string" },
          },
          required: ["name", "description", "stop_type", "duration_minutes"],
        },
      },
      required: ["day_id", "sort_order", "new_stop"],
    },
  },
  {
    name: "remove_stop",
    description: "Remove a stop from the itinerary. Use when the user wants to cut something from the day.",
    input_schema: {
      type: "object",
      properties: {
        stop_id: { type: "string", description: "UUID of the stop to remove" },
      },
      required: ["stop_id"],
    },
  },
];

function buildSystemPrompt(trip: Trip, days: Day[], stops: Stop[], extraContext?: string): string {
  const itineraryLines = days.map(day => {
    const dayStops = stops
      .filter(s => s.day_id === day.id && s.stop_type !== "transit")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s, i) => `  ${i + 1}. [stop_id: ${s.id}] ${s.name} (${s.stop_type}, ${s.duration_minutes} min)`)
      .join("\n");
    return `Day ${day.day_number} (day_id: ${day.id})${day.title ? ` — ${day.title}` : ""}:\n${dayStops || "  (no stops yet)"}`;
  }).join("\n\n");

  let prompt = `You are a travel planning assistant helping with a trip to ${trip.destination || trip.name}.

Trip details:
- Destination: ${trip.destination || trip.name}
- Duration: ${trip.duration || `${days.length} days`}
- Group: ${trip.group_type || "unknown"}${trip.group_detail ? ` — ${trip.group_detail}` : ""}
- Interests: ${trip.interests || "not specified"}
- Travel dates: ${trip.travel_dates || "not set"}
- Notes: ${trip.extra_notes || "none"}`;

  if (days.length > 0) {
    prompt += `\n\nCurrent itinerary:\n${itineraryLines}`;
  }

  prompt += `

When using tools, always consider the group composition, interests, and travel dates. For a family with kids, suggest kid-friendly options. If they mentioned specific interests in the notes, prioritize those. Never suggest something inappropriate for the group.

Use tools to make surgical edits when the user wants to change, add, or remove specific stops. For general questions or recommendations, respond with text only. Always explain what you changed and why it's a good fit for this group.

Collab day philosophy: When you mark a day as collab, it means you've done the research and have ideas, but there's no single compelling curation you're confident in. Maybe there's only one clear anchor and the rest is flexible. Maybe there are two equally good directions. You are NOT saying "I have nothing" — you're saying "I have options and want the user's input to pick a direction." Always come to the table with: (1) your reasoning for why this day is collab — what city/area it's in and why, (2) at least one anchor idea you're leaning toward, (3) 2-3 specific alternate directions, (4) a direct question to the user about which direction to go. Never say "wide open" or "anything goes" — share your framework and specific options.`;

  if (extraContext) {
    prompt += `\n\n=== ACTIVE DAY CONTEXT (IMPORTANT) ===\n${extraContext}\nAll ambiguous references like "this day", "today", "here", "this stop", "add something", "swap this out" etc. refer to the active day above unless the user explicitly names a different day. Always ground your responses in the active day context.`;
  }

  return prompt;
}

export async function askClaude({ tripId, messages, systemContext }: AskClaudeParams): Promise<AskClaudeResult> {
  try {
    const [tripRes, daysRes, stopsRes] = await Promise.all([
      supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
      supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
      supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
    ]);

    const trip = tripRes.data as Trip | null;
    const days = (daysRes.data || []) as Day[];
    const stops = (stopsRes.data || []) as Stop[];

    if (!trip) {
      return { text: "I couldn't load the trip details. Please try again.", toolCalls: [] };
    }

    const systemPrompt = buildSystemPrompt(trip, days, stops, systemContext);
    const useTools = days.length > 0 && stops.length > 0;

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        systemPrompt,
        max_tokens: 2048,
        ...(useTools ? { tools: TOOLS } : {}),
      }),
    });

    const data = await res.json();
    const blocks: Array<{ type: string; text?: string; name?: string; id?: string; input?: Record<string, unknown> }> = data.content || [];

    const textParts: string[] = [];
    const toolCalls: ToolCall[] = [];

    for (const block of blocks) {
      if (block.type === "text" && block.text) {
        textParts.push(block.text);
      } else if (block.type === "tool_use" && block.name && block.id && block.input) {
        toolCalls.push({ name: block.name, id: block.id, input: block.input });
      }
    }

    return {
      text: textParts.join("\n") || (toolCalls.length > 0 ? "" : "I didn't have a response for that."),
      toolCalls,
    };
  } catch (error) {
    console.error("askClaude error:", error);
    return { text: "Sorry, something went wrong. Please try again.", toolCalls: [] };
  }
}

export async function executeToolCall(
  tripId: string,
  toolCall: ToolCall,
): Promise<string> {
  const { name, input } = toolCall;

  try {
    if (name === "replace_stop") {
      const stopId = input.stop_id as string;
      const newStop = input.new_stop as Record<string, unknown>;

      // Get old stop to preserve day_id and sort_order
      const { data: oldStop } = await supabase.from("stops").select("*").eq("id", stopId).maybeSingle();
      if (!oldStop) return "Could not find the stop to replace.";

      await supabase.from("stops").delete().eq("id", stopId);
      await supabase.from("stops").insert({
        trip_id: tripId,
        day_id: oldStop.day_id,
        name: newStop.name,
        description: newStop.description || null,
        stop_type: newStop.stop_type || "visit",
        duration_minutes: newStop.duration_minutes || 60,
        latitude: newStop.latitude || null,
        longitude: newStop.longitude || null,
        cost_estimate: newStop.cost_estimate || null,
        cost_currency: (newStop.cost_currency as string) || "USD",
        sort_order: oldStop.sort_order,
        start_time: oldStop.start_time,
      });
      return `Replaced "${oldStop.name}" with "${newStop.name}"`;
    }

    if (name === "add_stop") {
      const dayId = input.day_id as string;
      const sortOrder = input.sort_order as number;
      const newStop = input.new_stop as Record<string, unknown>;

      // Shift existing stops down
      const { data: existingStops } = await supabase
        .from("stops")
        .select("id, sort_order")
        .eq("day_id", dayId)
        .eq("trip_id", tripId)
        .is("version_owner", null)
        .gte("sort_order", sortOrder)
        .order("sort_order", { ascending: false });

      if (existingStops) {
        for (const s of existingStops) {
          await supabase.from("stops").update({ sort_order: s.sort_order + 1 }).eq("id", s.id);
        }
      }

      await supabase.from("stops").insert({
        trip_id: tripId,
        day_id: dayId,
        name: newStop.name,
        description: newStop.description || null,
        stop_type: newStop.stop_type || "visit",
        duration_minutes: newStop.duration_minutes || 60,
        latitude: newStop.latitude || null,
        longitude: newStop.longitude || null,
        cost_estimate: newStop.cost_estimate || null,
        cost_currency: (newStop.cost_currency as string) || "USD",
        sort_order: sortOrder,
      });
      return `Added "${newStop.name}"`;
    }

    if (name === "remove_stop") {
      const stopId = input.stop_id as string;

      const { data: stop } = await supabase.from("stops").select("*").eq("id", stopId).maybeSingle();
      if (!stop) return "Could not find the stop to remove.";

      await supabase.from("stops").delete().eq("id", stopId);

      // Close the gap in sort_order
      const { data: laterStops } = await supabase
        .from("stops")
        .select("id, sort_order")
        .eq("day_id", stop.day_id)
        .eq("trip_id", stop.trip_id)
        .is("version_owner", null)
        .gt("sort_order", stop.sort_order)
        .order("sort_order");

      if (laterStops) {
        for (const s of laterStops) {
          await supabase.from("stops").update({ sort_order: s.sort_order - 1 }).eq("id", s.id);
        }
      }
      return `Removed "${stop.name}"`;
    }

    return `Unknown tool: ${name}`;
  } catch (error) {
    console.error("executeToolCall error:", error);
    return `Failed to execute ${name}. Please try again.`;
  }
}

export function getPromptChips(trip: Trip | null): string[] {
  if (!trip) return [];
  const chips: string[] = [];

  chips.push("Restaurant picks for today");

  const extra = (trip.extra_notes || "").toLowerCase();
  const groupType = (trip.group_type || "").toLowerCase();
  const groupDetail = (trip.group_detail || "").toLowerCase();

  if (groupType === "family" || groupDetail.match(/kid|child|toddler|teen|baby/i)) {
    chips.push("Activity ideas for kids");
  }

  chips.push("What if it rains?");

  if (extra.match(/dog|pet|puppy/)) {
    chips.push("Dog-friendly spots nearby");
  }

  chips.push("Route optimization");

  return chips.slice(0, 4);
}
