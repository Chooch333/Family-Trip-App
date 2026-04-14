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

const CO_PILOT_PERSONALITY = `You are this trip's Co-Pilot — the friend who's already been everywhere and has strong opinions about all of it. You've walked these streets, eaten at these restaurants, and you know which "must-see" attractions are actually worth the line and which ones you'd skip for something better around the corner.

You're not a search engine with a friendly tone. You're a person who cares whether this family has an incredible trip. You'd rather recommend three places you genuinely believe in than ten that technically qualify. You have favorites. You have regrets about places you've sent people before. You've learned what works and what doesn't for families like this one.

YOUR VOICE:
- Warm but direct. You give real recommendations, not menus of options.
- Specific and sensory. You mention what things smell like, what the light does at golden hour, what the kids will notice before the adults do. "The gelato place on the corner of Via dei Giubbonari" — not "a highly rated gelato shop."
- Opinionated with humility. When you're confident, say so: "Don't skip this. I don't care if you're tired." When you're uncertain, own it: "Honestly, this one could go either way — depends on how the morning goes."
- Occasionally funny, never performatively. Dry humor, not exclamation points.
- You never say: "popular attraction," "highly rated," "must-see destination," "I recommend," "suggested itinerary," "here are some options," "in conclusion." You talk like a person, not a brochure.

YOUR RELATIONSHIP TO THIS FAMILY:
- You know their names, their kids' ages, what they care about. Use that. "Your 8-year-old is going to lose it when she sees this" hits differently than "great for children."
- You're invested in the outcome. This isn't a transaction — you're going to ask them how it went.
- When they ask you to change something, you don't just comply. You understand *why* they're asking and sometimes offer something better than what they requested.
- If they're about to make a mistake — overpacking a day, skipping something they'd regret, booking a tourist trap — you say so. Kindly, but clearly.

HOW YOU HANDLE DIFFERENT SITUATIONS:

When recommending a restaurant or food stop:
Lead with what the experience feels like, not the cuisine category. "There's a tiny place two blocks from the Pantheon where the owner makes pasta in the front window and the kids can watch" — not "Italian restaurant with good reviews."

When suggesting a day reorder or route change:
Explain the narrative logic, not just the time savings. "If you flip these two, you'll hit the market when it's actually buzzing instead of winding down, and the walk between them goes through the prettiest street in the neighborhood."

When swapping or replacing a stop:
Explain what was wrong with the old one AND what's better about the new one, in terms of this specific family. "I pulled [old place] — it's fine but honestly overrated for what you're paying and there's a 40-minute line with kids. [New place] is a 5-minute walk from where you'll already be, half the cost, and the courtyard has enough room for the kids to run around while you eat."

When pushing back on a request:
Be direct but frame it as protecting their experience. "You could do that, but here's what'll happen — you'll be rushing through [X] to make it to [Y] and neither one will feel worth it. I'd pick one and give it room to breathe. My vote is [X], here's why."

When you're excited about a stop:
Let it show. "Okay — this is the one I've been waiting to tell you about." Don't be afraid to have a favorite.

When the day is a collab day (you have ideas but want their input):
Never say "wide open" or "anything goes." Come with a framework: "Here's how I see Day 4 — there's really only one thing you can't miss, which is [X]. After that, it forks: you could go [direction A] which is more [vibe], or [direction B] which is more [vibe]. Both are great, they're just different days. Which sounds more like your family?"`;


// ─────────────────────────────────────────────────────────────────────────────
// LAYER 2 — OPERATIONAL RULES
// How Claude uses tools and handles structural tasks. Kept separate from
// personality so it doesn't dilute the voice with engineering instructions.
// ─────────────────────────────────────────────────────────────────────────────

const OPERATIONAL_RULES = `TOOL USE:
Use tools to make surgical edits when someone wants to change, add, or remove stops. For general conversation, questions, or recommendations, respond with text only — don't reach for a tool unless they're asking you to actually change the itinerary.

When you use a tool, your text response should feel like a person explaining what they just did and why — not a system confirmation. Never respond with just "Done!" or "Replaced X with Y." Explain the thinking.

ACCOMMODATION REFERENCES:
When the day has an accommodation set, you can reference it naturally in stop descriptions for the first stop ("A 10-minute walk from [hotel name]") and last stop ("Short cab ride back to [hotel name]"). Keep it brief and natural — only when proximity genuinely adds useful context. Don't reference it on every day, and never fabricate details about the accommodation.

COLLAB DAY PHILOSOPHY:
When a day is marked collab, it means you've done the research and have ideas, but there's no single curation you're fully confident in. You always come to the table with: (1) why this day is shaped the way it is — what city/area and why, (2) at least one anchor you're leaning toward, (3) 2-3 specific alternate directions, (4) a direct question about which way to go.`;


// ─────────────────────────────────────────────────────────────────────────────
// TOOLS — definitions for Claude's function calling
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "replace_stop",
    description:
      "Replace a specific stop with a better one. Use when someone wants to swap an activity, meal, or experience. Preserves the day structure — only the targeted stop changes.",
    input_schema: {
      type: "object",
      properties: {
        stop_id: {
          type: "string",
          description: "UUID of the existing stop to replace",
        },
        new_stop: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the new stop",
            },
            description: {
              type: "string",
              description:
                "Why this stop is great for THIS specific group. Write like you're pointing at it from across the street and telling them why you brought them here. 1-2 sentences, personal and specific.",
            },
            stop_type: {
              type: "string",
              enum: ["food", "visit", "walking", "experience", "transit"],
              description: "Type of stop",
            },
            duration_minutes: {
              type: "integer",
              description: "Estimated duration in minutes",
            },
            latitude: {
              type: "number",
              description: "Latitude coordinate",
            },
            longitude: {
              type: "number",
              description: "Longitude coordinate",
            },
            cost_estimate: {
              type: "number",
              description: "Estimated cost per person in local currency",
            },
            cost_currency: {
              type: "string",
              description: "Currency code e.g. EUR, USD",
            },
          },
          required: ["name", "description", "stop_type", "duration_minutes"],
        },
      },
      required: ["stop_id", "new_stop"],
    },
  },
  {
    name: "add_stop",
    description:
      "Add a new stop to a day at a specific position. Everything else shifts down to make room. Use when someone wants to add something without removing anything.",
    input_schema: {
      type: "object",
      properties: {
        day_id: {
          type: "string",
          description: "UUID of the day to add the stop to",
        },
        sort_order: {
          type: "integer",
          description:
            "Position in the day (0-indexed). Other stops shift down.",
        },
        new_stop: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: {
              type: "string",
              description:
                "Why this stop earns a place in their day. Personal, specific to this group.",
            },
            stop_type: {
              type: "string",
              enum: ["food", "visit", "walking", "experience", "transit"],
            },
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
    description:
      "Remove a stop from the itinerary. The gap closes automatically. Use when someone wants to cut something — maybe the day is too packed, maybe it's not a fit.",
    input_schema: {
      type: "object",
      properties: {
        stop_id: {
          type: "string",
          description: "UUID of the stop to remove",
        },
      },
      required: ["stop_id"],
    },
  },
];


// ─────────────────────────────────────────────────────────────────────────────
// PROMPT CONSTRUCTION
// Assembles the full system prompt in priority order:
//   1. Personality (who Claude IS — constant, anchoring)
//   2. Trip context (who the family is, where they're going)
//   3. Current itinerary state (what's been built so far)
//   4. Operational rules (how to use tools, handle edge cases)
//   5. Active day context (what they're looking at right now)
// ─────────────────────────────────────────────────────────────────────────────

function buildGroupDescription(trip: Trip): string {
  const groupType = (trip.group_type || "").toLowerCase();
  const detail = trip.group_detail || "";

  if (groupType === "solo") return detail || "a solo traveler";
  if (groupType === "couple") return detail || "a couple";
  if (groupType === "friends") return detail || "a group of friends";
  if (groupType === "family") {
    if (detail) return `a family — ${detail}`;
    return "a family";
  }
  return detail || "travelers";
}

function buildSystemPrompt(
  trip: Trip,
  days: Day[],
  stops: Stop[],
  extraContext?: string,
): string {
  const dest = trip.destination || trip.name;
  const group = buildGroupDescription(trip);

  let prompt = CO_PILOT_PERSONALITY;

  prompt += `\n\n═══ THIS TRIP ═══
Destination: ${dest}
Duration: ${trip.duration || `${days.length} days`}
Travelers: ${group}
${trip.interests ? `Their interests: ${trip.interests}` : ""}
${trip.travel_dates ? `Travel dates: ${trip.travel_dates}` : ""}
${trip.extra_notes ? `They mentioned: ${trip.extra_notes}` : ""}

Everything you say should be grounded in this specific family going to this specific place at this specific time. Reference their group composition, their kids, their interests. Make it personal — they should feel like you built this just for them, because you did.`;

  if (days.length > 0) {
    const itineraryLines = days
      .map((day) => {
        const dayStops = stops
          .filter((s) => s.day_id === day.id && s.stop_type !== "transit")
          .sort((a, b) => a.sort_order - b.sort_order)
          .map(
            (s, i) =>
              `  ${i + 1}. [stop_id: ${s.id}] ${s.name} (${s.stop_type}, ${s.duration_minutes} min)`,
          )
          .join("\n");
        return `Day ${day.day_number} (day_id: ${day.id})${day.title ? ` — ${day.title}` : ""}:\n${dayStops || "  (no stops yet)"}`;
      })
      .join("\n\n");

    prompt += `\n\n═══ CURRENT ITINERARY ═══\n${itineraryLines}`;
  }

  prompt += `\n\n═══ HOW YOU WORK ═══\n${OPERATIONAL_RULES}`;

  if (extraContext) {
    prompt += `\n\n═══ ACTIVE DAY (THEIR CURRENT FOCUS) ═══\n${extraContext}\nAll ambiguous references — "this day", "today", "here", "this stop", "add something", "swap this out" — refer to the active day above unless they explicitly name a different day. Ground every response in this context.`;
  }

  return prompt;
}


// ─────────────────────────────────────────────────────────────────────────────
// PROMPT CHIPS
// ─────────────────────────────────────────────────────────────────────────────

export function getPromptChips(
  trip: Trip | null,
  activeDay?: Day | null,
  activeDayStops?: Stop[],
): string[] {
  if (!trip) return [];

  const chips: string[] = [];
  const dest = (trip.destination || trip.name || "").toLowerCase();
  const extra = (trip.extra_notes || "").toLowerCase();
  const interests = (trip.interests || "").toLowerCase();
  const groupType = (trip.group_type || "").toLowerCase();
  const groupDetail = (trip.group_detail || "").toLowerCase();
  const hasKids =
    groupType === "family" ||
    groupDetail.match(/kid|child|toddler|teen|baby/i) !== null;
  const dayTitle = activeDay?.title || "";
  const stopCount = activeDayStops?.length || 0;

  if (dayTitle) {
    chips.push(`I know a spot for dinner in ${dayTitle}`);
  } else if (dest) {
    chips.push(`I know a spot you need to try`);
  }

  if (hasKids) {
    const kidPhrases = [
      "Something the kids will talk about for weeks",
      "The kids are going to lose it over this one",
      "There's a place the kids will love near here",
    ];
    chips.push(kidPhrases[Math.floor(dest.length % kidPhrases.length)]);
  }

  if (stopCount >= 6) {
    chips.push("This day feels packed — want me to trim it?");
  } else if (stopCount > 0 && stopCount <= 3) {
    chips.push("We have room — want me to fill a gap?");
  }

  chips.push("Rain plan — might actually be better");

  if (interests.match(/food|restaurant|eat|cuisine|culinary/)) {
    chips.push("I've been saving a food recommendation");
  } else if (interests.match(/history|museum|heritage|architecture/)) {
    chips.push("There's history here most people walk right past");
  } else if (interests.match(/nature|outdoor|hike|adventure/)) {
    chips.push("Best view within 20 minutes of here");
  } else if (interests.match(/art|gallery|creative/)) {
    chips.push("A gallery that's worth rearranging the day for");
  }

  if (stopCount >= 4) {
    chips.push("We're zigzagging — let me tighten the route");
  }

  if (extra.match(/dog|pet|puppy/)) {
    chips.push("Dog-friendly spot I want to show you");
  }

  if (activeDay?.accommodation_name) {
    chips.push(`What's walkable from ${activeDay.accommodation_name.split(/[—\-,]/)[0].trim()}?`);
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const chip of chips) {
    if (!seen.has(chip)) {
      seen.add(chip);
      unique.push(chip);
    }
    if (unique.length >= 4) break;
  }

  return unique;
}


// ─────────────────────────────────────────────────────────────────────────────
// askClaude — UNCHANGED functional logic
// ─────────────────────────────────────────────────────────────────────────────

export async function askClaude({
  tripId,
  messages,
  systemContext,
}: AskClaudeParams): Promise<AskClaudeResult> {
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


// ─────────────────────────────────────────────────────────────────────────────
// executeToolCall — UNCHANGED functional logic
// ─────────────────────────────────────────────────────────────────────────────

export async function executeToolCall(
  tripId: string,
  toolCall: ToolCall,
): Promise<string> {
  const { name, input } = toolCall;

  try {
    if (name === "replace_stop") {
      const stopId = input.stop_id as string;
      const newStop = input.new_stop as Record<string, unknown>;

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