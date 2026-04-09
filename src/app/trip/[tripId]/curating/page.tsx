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
      // Auth check
      const m = await getMemberForTrip(tripId);
      if (!m) { router.replace(`/trip/${tripId}/invite`); return; }
      setMember(m);

      // Load trip
      const { data: tripData } = await supabase.from("trips").select("*").eq("id", tripId).maybeSingle();
      if (!tripData) { setError("Trip not found."); return; }
      const t = tripData as Trip;
      setTrip(t);

      // Check if already curated (has days)
      const { count } = await supabase.from("days").select("*", { count: "exact", head: true }).eq("trip_id", tripId);
      if (count && count > 0) {
        router.push(`/trip/${tripId}`);
        return;
      }

      // Build the curation prompt
      const groupDesc = t.group_type === "Solo" ? (t.group_detail || "solo traveler") :
        t.group_type === "Friends" ? (t.group_detail || "group of friends") :
        t.group_type === "Family" ? `family with ${t.group_detail || "kids"}` : "travelers";
      const durDays = t.duration === "Weekend" ? "3" : t.duration === "Short trip" ? "5" : t.duration === "Full week" ? "7" : t.duration === "Extended" ? "10" : t.duration || "7";
      const interestStr = t.interests ? `Interests: ${t.interests}.` : "";
      const datesStr = t.travel_dates ? `Travel dates: ${t.travel_dates}.` : "";
      const notesStr = t.extra_notes ? `Additional notes: ${t.extra_notes}.` : "";
      const prompt = `Plan a ${t.duration || durDays + " day"} trip to ${t.destination || t.name} for ${groupDesc}. ${datesStr} ${interestStr} ${notesStr} Make it amazing.`;

      const systemPrompt = `You are a family trip planning assistant. Generate a complete, fully curated day-by-day itinerary.
You MUST respond with a JSON code block wrapped in \`\`\`json and \`\`\` markers.
The JSON format:
{"trip_summary":"An exciting 3-4 sentence paragraph summarizing the whole trip.","days":[{"day_number":1,"title":"City/area","narrative":"2-3 sentences setting the tone.","reasoning":"Why you built this day this way — what the anchors are, why this order, what trade-offs you considered. 2-3 sentences.","stops":[{"name":"Place","description":"Why this is great for this group.","ai_note":"One sentence on why Claude picked this stop specifically.","stop_type":"visit","latitude":0.0,"longitude":0.0,"start_time":"9:00 AM","duration_minutes":90,"cost_estimate":0}]}]}
Rules:
- ${durDays} days, 4-7 stops per day
- Real coordinates for non-transit stops
- stop_type: visit, food, transit, walk_by, guided_tour
- Transit stops for inter-city travel (no coordinates needed)
- 12-hour AM/PM times
- Every stop needs an engaging description for ${groupDesc}
- Every stop needs an ai_note — a single sentence explaining why Claude chose it
- Each day needs a narrative AND a reasoning field
- Include a trip_summary at the top level
- Include food stops for meals
- All days are fully curated — mark every day with high confidence
${t.travel_dates ? `- Travel dates: ${t.travel_dates}. Factor in weather, seasonal closures, holidays, local events, peak/off-season pricing, and seasonal activities.` : ""}`;

      try {
        const res = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: [{ role: "user", content: prompt }], systemPrompt, max_tokens: 16384 }),
        });
        const data = await res.json();
        const contentBlocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
        const fullContent = contentBlocks.filter(b => b.type === "text").map(b => b.text || "").join("\n") || (typeof data.content === "string" ? data.content : "");
        const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);

        if (jsonMatch) {
          const itinerary = JSON.parse(jsonMatch[1]);

          // Save trip_summary
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

  // Build progress steps from intake
  const progressSteps = [
    "Checking must-see landmarks",
    "Researching weather and crowds",
    ...((trip?.extra_notes || "").toLowerCase().match(/food|restaurant|eat|cuisine/) ? ["Finding the best food spots"] : []),
    ...((trip?.interests || "").toLowerCase().match(/history|museum|heritage/) ? ["Curating historical sites"] : []),
    ...(trip?.group_type === "Family" ? ["Filtering for family-friendly options"] : []),
    ...((trip?.extra_notes || "").toLowerCase().match(/dog|pet/) ? ["Finding pet-friendly venues"] : []),
    "Building day-by-day draft",
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
        <p className="text-[18px] font-semibold text-gray-900 mb-2">Claude is curating your trip</p>
        <p className="text-[13px] text-gray-500 mb-6">
          Researching {trip?.destination || "your destination"}{trip?.travel_dates ? ` in ${trip.travel_dates}` : ""} for your {trip?.group_type?.toLowerCase() || "group"}...
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
