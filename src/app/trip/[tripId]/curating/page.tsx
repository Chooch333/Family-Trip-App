"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { getMemberForTrip } from "@/lib/session";
import { supabase } from "@/lib/supabase";
import TripTour from "@/components/TripTour";
import type { Trip, TripMember, Day, Stop } from "@/lib/database.types";

const MapCinematic = dynamic(() => import("@/components/MapCinematic"), { ssr: false });

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

function buildBaseSystemPrompt(trip: Trip, totalDays: number): string {
  const dest = trip.destination || trip.name;
  const group = buildGroupDescription(trip);
  return `You are this trip's Co-Pilot — the friend who's already been to ${dest} and has strong opinions about all of it. You've walked these streets, eaten at these restaurants, and you know which "must-see" spots are actually worth the line and which ones you'd skip for something better around the corner.

You're building a ${totalDays}-day trip for ${group}. You know who they are. Every choice you make should feel like it was made for THEM specifically — not a generic "top 10" list. When you describe a stop, write like you're standing outside it with the family, pointing at the door, telling them why you brought them here.

You MUST respond with a JSON code block wrapped in \`\`\`json and \`\`\` markers.

JSON format:
{"days":[{"day_number":1,"title":"City/area","narrative":"...","reasoning":"...","stops":[{"name":"Place","description":"...","ai_note":"...","stop_type":"visit","is_anchor":false,"latitude":0.0,"longitude":0.0,"start_time":"9:00 AM","duration_minutes":90,"cost_estimate":0}]}]}

FIELD VOICE GUIDE:

narrative (per day): How you'd brief the family at breakfast. Set the energy, the theme, what makes today different from yesterday. "Okay, today's the big one — Colosseum, Forum, the whole ancient Rome experience. We're hitting it early before the crowds and the heat. Afternoon is deliberately chill because everyone's going to need it."

reasoning (per day): Your internal logic made visible. What are the anchors, why this order, what trade-offs you considered. "The Colosseum first thing is non-negotiable — the line triples by 10am. I put lunch near the Pantheon because it's on the walk back and the piazza is perfect for kids to run around. Afternoon is light because Day 1 jet lag is real."

description (per stop): Why THIS stop for THIS family. Not what it is — why it matters to them. Use sensory details. "The gelato place on the corner of Via dei Giubbonari — the owner makes it fresh in the window and the kids will press their faces against the glass picking flavors. Get the pistachio, trust me." Never write "popular attraction" or "highly rated."

ai_note (per stop): Your most personal take. Why you picked THIS over the alternatives. "I chose this over the more famous place down the street because there's no line, it's half the price, and honestly the view is better." This should feel like a whispered aside, not a data point.

STRUCTURAL RULES:
- 4-7 stops per day
- Real latitude/longitude for every non-transit stop
- stop_type: visit, food, transit, walk_by, guided_tour
- Transit stops for inter-city travel (no coordinates needed)
- 12-hour AM/PM times (e.g. "9:00 AM", "2:30 PM")
- Include food stops for meals — and have opinions about them
- Every stop needs a description AND an ai_note
- Every stop needs an is_anchor boolean: true for the 1-3 stops per day you're most confident about — the non-negotiables, the reason that day exists. These are stops you'd fight to keep if the day got trimmed. Set false for everything else (flexible — good pick but open to swapping).
- Every day needs a narrative AND a reasoning field
${trip.travel_dates ? `- Travel dates: ${trip.travel_dates}. Factor in weather, seasonal closures, holidays, local events, and what the destination actually feels like at that time of year.` : ""}`;
}

interface GeneratedDaySummary {
  day_number: number;
  title: string;
  stops: string[];
}

interface StopData {
  name: string;
  description?: string;
  ai_note?: string;
  is_anchor?: boolean;
  latitude?: number;
  longitude?: number;
  start_time?: string;
  duration_minutes?: number;
  cost_estimate?: number;
  stop_type?: string;
}

interface DayData {
  day_number: number;
  title: string;
  narrative?: string;
  reasoning?: string;
  stops?: StopData[];
}

export default function CuratingPage() {
  const router = useRouter();
  const params = useParams();
  const tripId = params.tripId as string;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [, setMember] = useState<TripMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalDays, setTotalDays] = useState(0);
  const [generatedDays, setGeneratedDays] = useState(0);
  const [phase, setPhase] = useState<"loading" | "cinematic" | "tour">("loading");
  const [tourData, setTourData] = useState<{ trip: Trip; days: Day[]; stops: Stop[]; dayColors: string[] } | null>(null);
  const [generationDone, setGenerationDone] = useState(false);
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

      const durDaysStr = t.duration === "Weekend" ? "3" : t.duration === "Short trip" ? "5" : t.duration === "Full week" ? "7" : t.duration === "Extended" ? "10" : t.duration || "7";
      const total = parseInt(durDaysStr) || 7;
      setTotalDays(total);

      const baseSystemPrompt = buildBaseSystemPrompt(t, total);
      const group = buildGroupDescription(t);
      const dest = t.destination || t.name;

      const chunkSize = 3;
      const chunks = Math.ceil(total / chunkSize);
      const dayColors = generateDayColors(total);
      const summaries: GeneratedDaySummary[] = [];
      let saved = 0;

      async function generateChunk(startDay: number, endDay: number, attempt = 0): Promise<boolean> {
        const prevContext = summaries.length > 0
          ? `\n\nDays already planned:\n${summaries.map(s => `Day ${s.day_number} — ${s.title}: ${s.stops.join(", ")}`).join("\n")}\n\nNow generate days ${startDay} through ${endDay}. Maintain geographic flow and avoid repeating locations from previous days. Same JSON format.`
          : `\n\nGenerate days ${startDay} through ${endDay} of ${total}.`;
        const systemPrompt = baseSystemPrompt + prevContext;
        const userPrompt = `Generate days ${startDay} through ${endDay} of my ${total}-day trip to ${dest}.`;

        try {
          const res = await fetch("/api/ai/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: [{ role: "user", content: userPrompt }], systemPrompt, max_tokens: 8192 }),
          });
          const data = await res.json();
          const contentBlocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
          const fullContent = contentBlocks.filter(b => b.type === "text").map(b => b.text || "").join("\n") || (typeof data.content === "string" ? data.content : "");
          const jsonMatch = fullContent.match(/```json\s*([\s\S]*?)```/);
          if (!jsonMatch) throw new Error("No JSON in response");

          const parsed = JSON.parse(jsonMatch[1]);
          const daysArr: DayData[] = parsed.days || [];
          if (daysArr.length === 0) throw new Error("No days in response");

          for (const dayData of daysArr) {
            const color = dayColors[(dayData.day_number - 1) % dayColors.length];
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

            const stops = dayData.stops || [];
            if (stops.length > 0) {
              const stopRows = stops.map((s, j) => {
                const isTransit = s.stop_type === "transit";
                return {
                  trip_id: tripId,
                  day_id: dayRow.id,
                  name: s.name,
                  description: s.description || null,
                  ai_note: s.ai_note || null,
                  is_anchor: !!s.is_anchor,
                  latitude: isTransit ? null : (s.latitude || null),
                  longitude: isTransit ? null : (s.longitude || null),
                  start_time: s.start_time || null,
                  duration_minutes: s.duration_minutes || 60,
                  cost_estimate: s.cost_estimate ?? null,
                  stop_type: s.stop_type || "visit",
                  sort_order: j,
                  created_by: m!.id,
                };
              });
              await supabase.from("stops").insert(stopRows);
            }

            summaries.push({
              day_number: dayData.day_number,
              title: dayData.title,
              stops: stops.slice(0, 5).map(s => s.name),
            });
            saved += 1;
            setGeneratedDays(saved);
          }
          return true;
        } catch (err) {
          console.error(`Chunk ${startDay}-${endDay} failed (attempt ${attempt + 1}):`, err);
          if (attempt === 0) return generateChunk(startDay, endDay, 1);
          return false;
        }
      }

      for (let i = 0; i < chunks; i++) {
        const startDay = i * chunkSize + 1;
        const endDay = Math.min((i + 1) * chunkSize, total);
        const ok = await generateChunk(startDay, endDay);
        if (!ok) {
          setError(`Generated ${saved} of ${total} days. Some days couldn't be created — you can add them from the dashboard.`);
          setTimeout(() => router.push(`/trip/${tripId}`), 2500);
          return;
        }
      }

      try {
        const summaryRes = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: `Based on the itinerary you just built across ${total} days for ${group} going to ${dest}, write an exciting 3-4 sentence trip summary paragraph. It should make them feel the trip before they see the details — an emotional preview, not a table of contents.\n\nDays:\n${summaries.map(s => `Day ${s.day_number} — ${s.title}`).join("\n")}` }],
            systemPrompt: "You are the trip's Co-Pilot. Write short, vivid, opinionated trip summary paragraphs. Respond with just the paragraph text — no preamble, no JSON, no quotes.",
            max_tokens: 512,
          }),
        });
        const summaryData = await summaryRes.json();
        const summaryBlocks: Array<{ type: string; text?: string }> = Array.isArray(summaryData.content) ? summaryData.content : [];
        const summaryText = summaryBlocks.filter(b => b.type === "text").map(b => b.text || "").join("\n").trim();
        if (summaryText) {
          await supabase.from("trips").update({ trip_summary: summaryText }).eq("id", tripId);
        }
      } catch (err) {
        console.error("Trip summary generation failed:", err);
      }

      // Mark generation complete — tour phase handles redirect
      setGenerationDone(true);
      if (phase !== "tour") {
        router.push(`/trip/${tripId}`);
      }
    }

    curate();
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest = trip?.destination || "your destination";

  // Phase transitions
  // Loading → cinematic after brief delay
  useEffect(() => {
    const timer = setTimeout(() => {
      if (phase === "loading") setPhase("cinematic");
    }, 2000);
    return () => clearTimeout(timer);
  }, [phase]);

  // Cinematic → tour at 75% threshold
  useEffect(() => {
    if (phase !== "cinematic" || totalDays === 0) return;
    const threshold = Math.ceil(totalDays * 0.75);
    if (generatedDays >= threshold) {
      // Load current data from Supabase for the tour
      (async () => {
        const [tripRes, daysRes, stopsRes] = await Promise.all([
          supabase.from("trips").select("*").eq("id", tripId).maybeSingle(),
          supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
          supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
        ]);
        if (tripRes.data && daysRes.data && stopsRes.data) {
          const loadedDays = daysRes.data as Day[];
          setTourData({
            trip: tripRes.data as Trip,
            days: loadedDays,
            stops: stopsRes.data as Stop[],
            dayColors: generateDayColors(loadedDays.length),
          });
          setPhase("tour");
        }
      })();
    }
  }, [phase, generatedDays, totalDays, tripId]);

  // Handle tour completion
  function handleTourComplete() {
    // Set sessionStorage flag so workspace doesn't show tour again
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`tour_seen_${tripId}`, "1");
    }
    if (generationDone) {
      router.push(`/trip/${tripId}`);
    } else {
      // Generation still running — show brief finishing state then redirect
      setPhase("loading");
    }
  }

  // When generation finishes and we're in loading (post-tour waiting), redirect
  useEffect(() => {
    if (generationDone && phase === "loading" && tourData) {
      // Small delay so the user sees "finishing" message
      const timer = setTimeout(() => router.push(`/trip/${tripId}`), 1500);
      return () => clearTimeout(timer);
    }
  }, [generationDone, phase, tourData, tripId, router]);
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
      <p className="text-red-500 text-center max-w-sm px-4">{error}</p>
    </div>
  );

  const progressPct = totalDays > 0 ? Math.min(100, (generatedDays / totalDays) * 100) : 0;

  // ── PHASE: TOUR ──
  if (phase === "tour" && tourData) {
    return (
      <TripTour
        trip={tourData.trip}
        days={tourData.days}
        stops={tourData.stops}
        dayColors={tourData.dayColors}
        onComplete={handleTourComplete}
      />
    );
  }

  // ── PHASE: CINEMATIC ──
  if (phase === "cinematic") {
    return (
      <div className="h-screen relative" style={{ background: "#0a0a0a" }}>
        <MapCinematic tripId={tripId} destination={trip?.destination || trip?.name || ""} refreshTrigger={generatedDays} />

        {/* Floating progress overlay */}
        <div style={{
          position: "absolute", top: 24, left: "50%", transform: "translateX(-50%)",
          background: "rgba(0,0,0,0.6)", backdropFilter: "blur(8px)",
          borderRadius: 10, padding: "14px 24px", zIndex: 10,
          textAlign: "center", minWidth: 260,
        }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: "rgba(255,255,255,0.8)", marginBottom: 6 }}>
            Your Co-Pilot is building your trip
          </div>
          {totalDays > 0 && (
            <>
              <div style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", marginBottom: 6 }}>
                Day {generatedDays} of {totalDays}
              </div>
              <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
                <div style={{ height: "100%", borderRadius: 2, background: "#1D9E75", transition: "width 0.5s ease", width: `${progressPct}%` }} />
              </div>
            </>
          )}
        </div>

        {/* Floating Co-Pilot status messages */}
        <div style={{
          position: "absolute", bottom: 24, right: 24, zIndex: 10,
          display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end",
        }}>
          {progressSteps.slice(0, Math.min(progressSteps.length, Math.floor(generatedDays / (totalDays / progressSteps.length || 1)) + 1)).map((step, i) => (
            <div key={step} style={{
              fontSize: 12, color: "rgba(255,255,255,0.35)", fontWeight: 500,
              animation: "fadeIn 0.5s ease forwards",
              animationDelay: `${i * 0.3}s`,
              opacity: 0,
            }}>
              {step}
            </div>
          ))}
        </div>

        <style>{`
          @keyframes fadeIn {
            from { opacity: 0; transform: translateY(8px); }
            to { opacity: 1; transform: translateY(0); }
          }
        `}</style>
      </div>
    );
  }

  // ── PHASE: LOADING (initial + post-tour finishing) ──
  return (
    <div className="h-screen flex items-center justify-center" style={{ background: "#0a0a0a" }}>
      <div className="text-center max-w-sm mx-auto px-4">
        <div className="w-12 h-12 rounded-full border-[3px] border-gray-700 border-t-emerald-500 animate-spin mx-auto mb-6" />
        <p style={{ fontSize: 18, fontWeight: 600, color: "white", marginBottom: 8 }}>
          {tourData ? "Finishing up..." : "Your Co-Pilot is building your trip"}
        </p>
        <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginBottom: 16 }}>
          {tourData
            ? "Just a few more seconds."
            : `Putting together ${dest}${trip?.travel_dates ? ` for ${trip.travel_dates}` : ""}`}
        </p>
        {totalDays > 0 && !tourData && (
          <div style={{ width: "100%", height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{ height: "100%", borderRadius: 2, background: "#1D9E75", transition: "width 0.5s ease", width: `${progressPct}%` }} />
          </div>
        )}
      </div>
    </div>
  );
}
