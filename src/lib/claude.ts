import { supabase } from "./supabase";
import type { Trip, Day, Stop } from "./database.types";

interface AskClaudeParams {
  tripId: string;
  messages: { role: "user" | "assistant"; content: string }[];
  systemContext?: string;
}

function buildSystemPrompt(trip: Trip, days: Day[], stops: Stop[], extraContext?: string): string {
  const itineraryLines = days.map(day => {
    const dayStops = stops
      .filter(s => s.day_id === day.id && s.stop_type !== "transit")
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(s => s.name)
      .join(", ");
    return `Day ${day.day_number}${day.title ? ` — ${day.title}` : ""}: ${dayStops || "(no stops yet)"}`;
  }).join("\n");

  let prompt = `You are a travel planning assistant helping with a trip to ${trip.destination || trip.name}.

Trip details:
- Duration: ${trip.duration || `${days.length} days`}
- Group: ${trip.group_type || "unknown"}${trip.group_detail ? ` — ${trip.group_detail}` : ""}
- Interests: ${trip.interests || "not specified"}
- Travel dates: ${trip.travel_dates || "not set"}
- Notes: ${trip.extra_notes || "none"}`;

  if (days.length > 0) {
    prompt += `\n\nCurrent itinerary:\n${itineraryLines}`;
  }

  if (extraContext) {
    prompt += `\n\n${extraContext}`;
  }

  prompt += `\n\nRespond conversationally and helpfully. Keep answers concise but specific to this trip and group. When suggesting changes to the itinerary, explain why they'd be good for this specific group.`;

  return prompt;
}

export async function askClaude({ tripId, messages, systemContext }: AskClaudeParams): Promise<string> {
  try {
    // Fetch trip data for context
    const [tripRes, daysRes, stopsRes] = await Promise.all([
      supabase.from("trips").select("*").eq("id", tripId).single(),
      supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
      supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
    ]);

    const trip = tripRes.data as Trip | null;
    const days = (daysRes.data || []) as Day[];
    const stops = (stopsRes.data || []) as Stop[];

    if (!trip) {
      return "I couldn't load the trip details. Please try again.";
    }

    const systemPrompt = buildSystemPrompt(trip, days, stops, systemContext);

    const res = await fetch("/api/ai/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        systemPrompt,
        max_tokens: 2048,
      }),
    });

    const data = await res.json();
    return data.content || "I didn't have a response for that.";
  } catch (error) {
    console.error("askClaude error:", error);
    return "Sorry, something went wrong. Please try again.";
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
