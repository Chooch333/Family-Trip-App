"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import type { Trip, TripMember } from "@/lib/database.types";

function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const H = [145, 165, 180, 195, 220, 250, 280, 310], S = [55, 60, 55, 50, 55, 50, 50, 45], L = [33, 38, 40, 42, 42, 40, 38, 38];
  return Array.from({ length: count }, (_, i) => {
    const t = i / (count - 1), idx = t * (H.length - 1), lo = Math.floor(idx), hi = Math.min(lo + 1, H.length - 1), f = idx - lo;
    return `hsl(${Math.round(H[lo] + (H[hi] - H[lo]) * f)}, ${Math.round(S[lo] + (S[hi] - S[lo]) * f)}%, ${Math.round(L[lo] + (L[hi] - L[lo]) * f)}%)`;
  });
}

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

function buildCurationPrompt(trip: Trip): { userPrompt: string; systemPrompt: string } {
  const dest = trip.destination || trip.name;
  const group = buildGroupDescription(trip);
  const durDays = trip.duration === "Weekend" ? "3" : trip.duration === "Short trip" ? "5" : trip.duration === "Full week" ? "7" : trip.duration === "Extended" ? "10" : trip.duration || "7";

  const userPrompt = `Build me a ${trip.duration || durDays + " day"} trip to ${dest} for ${group}.${trip.travel_dates ? ` We're going ${trip.travel_dates}.` : ""}${trip.interests ? ` We're into ${trip.interests}.` : ""}${trip.extra_notes ? ` Also: ${trip.extra_notes}.` : ""} Make it incredible.`;

  const systemPrompt = `You are this trip's Co-Pilot — the friend who's already been to ${dest} and has strong opinions about all of it. You've walked these streets, eaten at these restaurants, and you know which "must-see" spots are actually worth the line and which ones you'd skip for something better around the corner.

You're building a trip for ${group}. You know who they are. Every choice you make should feel like it was made for THEM specifically — not a generic "top 10" list. When you describe a stop, write like you're standing outside it with the family, pointing at the door, telling them why you brought them here.

You MUST respond with a JSON code block wrapped in \`\`\`json and \`\`\` markers.

JSON format:
{"trip_summary":"...","days":[{"day_number":1,"title":"City/area","narrative":"...","reasoning":"...","stops":[{"name":"Place","description":"...","ai_note":"...","stop_type":"visit","latitude":0.0,"longitude":0.0,"start_time":"9:00 AM","duration_minutes":90,"cost_estimate":0}]}]}

FIELD VOICE GUIDE:

trip_summary: Your opening pitch to the family. 3-4 sentences that make them feel the trip before they see the details. Not a table of contents — an emotional preview. "You're going to fall in love with this country. The first few days are about getting your bearings in Rome — ancient stuff in the morning while the kids have energy, long lunches in piazzas, gelato on every corner. Then we head north to Tuscany where things slow way down."

narrative (per day): How you'd brief the family at breakfast. Set the energy, the theme, what makes today different from yesterday. "Okay, today's the big one — Colosseum, Forum, the whole ancient Rome experience. We're hitting it early before the crowds and the heat. Afternoon is deliberately chill because everyone's going to need it."

reasoning (per day): Your internal logic made visible. What are the anchors, why this order, what trade-offs you considered. "The Colosseum first thing is non-negotiable — the line triples by 10am. I put lunch near the Pantheon because it's on the walk back and the piazza is perfect for kids to run around. Afternoon is light because Day 1 jet lag is real."

description (per stop): Why THIS stop for THIS family. Not what it is — why it matters to them. Use sensory details. "The gelato place on the corner of Via dei Giubbonari — the owner makes it fresh in the window and the kids will press their faces against the glass picking flavors. Get the pistachio, trust me." Never write "popular attraction" or "highly rated."

ai_note (per stop): Your most personal take. Why you picked THIS over the alternatives. "I chose this over the more famous place down the street because there's no line, it's half the price, and honestly the view is better." This should feel like a whispered aside, not a data point.

STRUCTURAL RULES:
- ${durDays} days, 4-7 stops per day
- Real latitude/longitude for every non-transit stop
- stop_type: visit, food, transit, walk_by, guided_tour
- Transit stops for inter-city travel (no coordinates needed)
- 12-hour AM/PM times (e.g. "9:00 AM", "2:30 PM")
- Include food stops for meals — and have opinions about them
- Every stop needs a description AND an ai_note
- Every day needs a narrative AND a reasoning field
- Include a trip_summary at the top level
${trip.travel_dates ? `- Travel dates: ${trip.travel_dates}. Factor in weather, seasonal closures, holidays, local events, and what the destination actually feels like at that time of year.` : ""}`;

  return { userPrompt, systemPrompt };
}

export default function CuratingPage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [member, setMember] = useState<TripMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function curate() {
      const m = await getMemberForTrip(tripId);
      if (!m) { router.replace(`/trip/${tripId}/invite`); return; }
      setMember(m);

      const { data: tripData } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
      if (!tripData) { setError("Trip not found."); return; }
      const t = tripData as Trip;
      setTrip(t);

      const { count } = await supabase.from("days").select("*", { count: "exact", head: true }).eq("trip_id", tripId);
      if (count && count > 0) {
        router.push(`/trip/${tripId}`);
        return;
      }

      const { userPrompt, systemPrompt } = buildCurationPrompt(t);

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: userPrompt }], systemPrompt, max_tokens: 16384 }),
        });
        const data = await res.json();
        const contentBlocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
        const fullContent = contentBlocks.filter(b => b.type === "text").map(b => b.text || "").join("\n") || (typeof data.content === "string" ? data.content : "");
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);

        if (jsonMatch) {
          const itinerary = JSON.parse(jsonMatch[1]);

          if (itinerary.trip_summary) {
            await supabase.from("trips").update({ trip_summary: itinerary.trip_summary }).eq("id", tripId);
          }

          if (itinerary.days && Array.isArray(itinerary.days)) {
            const dayColors = generateDayColors(itinerary.days.length);
            for (let i = 0; i < itinerary.days.length; i++) {
              const dayData = itinerary.days[i];
              const color = dayColors[i % dayColors.length];
              const { data: dayRow } = await supabase.from("days").insert({
                trip_id: tripId,
                day_number: dayData.day_number,
                title: dayData.title,
                color,
                narrative: dayData.narrative || null,
                reasoning: dayData.reasoning || null,
                vibe_status: "locked",
              }).select().single();
              if (!dayRow) continue;
              for (let j = 0; j < (dayData.stops || []).length; j++) {
                const s = dayData.stops[j];
                const isTransit = s.stop_type === "transit";
                await supabase.from("stops").insert({
                  trip_id: tripId,
                  day_id: dayRow.id,
                  name: s.name,
                  description: s.description || null,
                  ai_note: s.ai_note || null,
                  latitude: isTransit ? null : (s.latitude || null),
                  longitude: isTransit ? null : (s.longitude || null),
                  start_time: s.start_time || null,
                  duration_minutes: s.duration_minutes || 60,
                  cost_estimate: s.cost_estimate ?? null,
                  stop_type: s.stop_type || "visit",
                  sort_order: j,
                  created_by: m.id,
                });
              }
            }
          }
        }
      } catch (err) {
        console.error("Curation failed:", err);
        setError("Trip curation failed. Please try again.");
        return;
      }

      router.push(`/trip/${tripId}`);
    }

    curate();
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Progress steps — personality-aligned
  const dest = trip?.destination || "your destination";
  const progressSteps = [
    `Walking the streets of ${dest} in my head`,
    "Checking what's actually worth the hype",
    ...((trip?.extra_notes || "").toLowerCase().match(/food|restaurant|eat|cuisine/) ? ["Calling in some food recommendations"] : []),
    ...((trip?.interests || "").toLowerCase().match(/history|museum|heritage/) ? ["Digging up the history worth knowing"] : []),
    ...(trip?.group_type === "Family" ? ["Making sure every stop works for the kids"] : []),
    ...((trip?.extra_notes || "").toLowerCase().match(/dog|pet/) ? ["Sniffing out the dog-friendly spots"] : []),
    "Putting the days in the right order",
    "Almost ready — just tightening a few things",
  ];

  if (error) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <p className="text-red-500">{error}</p>
    </div>
  );

  return (
    <div className="h-screen flex items-center justify-center bg-white">
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="w-12 h-12 rounded-full border-[3px] border-gray-200 border-t-emerald-500 animate-spin mx-auto mb-6" />
        <p className="text-[18px] font-semibold text-gray-900 mb-2">Your Co-Pilot is building your trip</p>
        <p className="text-[13px] text-gray-500 mb-6">
          Putting together {dest}{trip?.travel_dates ? ` for ${trip.travel_dates}` : ""} — this takes a minute because I'm being picky.
        </p>
        <div className="flex flex-col gap-2.5 text-left">
          {progressSteps.map((step, i) => (
            <div key={step} className="flex items-center gap-2.5 text-[13px] animate-fade-in" style={{ animationDelay: `${i * 1.2}s`, animationFillMode: "backwards" }}>
              <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span className="text-gray-700">{step}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
