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
  return `You are this trip's curator — the friend who's already been to ${dest} and has strong opinions about all of it. You've walked these streets, eaten at these restaurants, and you know which "must-see" spots are actually worth the line and which ones you'd skip for something better around the corner.

You're building a ${totalDays}-day trip for ${group}. You know who they are. Every choice you make should feel like it was made for THEM specifically — not a generic "top 10" list. When you describe a stop, write like you're standing outside it with the family, pointing at the door, telling them why you brought them here.

You MUST respond with a JSON code block wrapped in \`\`\`json and \`\`\` markers.

JSON format:
{"days":[{"day_number":1,"title":"City/area","narrative":"...","reasoning":"...","stops":[{"name":"Place","description":"...","ai_note":"...","stop_type":"visit","photo_category":"museum","is_anchor":false,"latitude":0.0,"longitude":0.0,"start_time":"9:00 AM","duration_minutes":90,"cost_estimate":0}]}]}

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
- Every stop needs a photo_category: the best generic photo subject for this kind of stop. Exactly one of: coffee, meal, bakery, park-trail, museum, water, main-street, shop, brewery
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
  photo_category?: string;
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

  // ── Dual-source photo pipeline: Unsplash first (pro quality), Google Places fallback ──
  // usedUrls tracks all URLs already picked across the entire slideshow to prevent repeats
  const usedUrls = new Set<string>();

  async function fetchSlideImages(query: string, tripId: string, count = 2): Promise<string[]> {
    const excludeParam = Array.from(usedUrls).join(",");

    // Try Unsplash first — professional editorial photos
    try {
      const unsplashRes = await fetch(`/api/unsplash/search?${new URLSearchParams({ query, count: String(count), exclude: excludeParam })}`);
      if (unsplashRes.ok) {
        const data = await unsplashRes.json();
        const urls = (data.images || []).map((img: any) => img.url).filter((u: string) => u && !usedUrls.has(u));
        if (urls.length >= count) {
          const picked = urls.slice(0, count);
          picked.forEach((u: string) => usedUrls.add(u));
          return picked;
        }
        // If we got some but not enough, keep what we got and try Places for the rest
        if (urls.length > 0) {
          urls.forEach((u: string) => usedUrls.add(u));
          const remaining = count - urls.length;
          try {
            const placesRes = await fetch(`/api/places/photos?${new URLSearchParams({ query, count: String(remaining), tripId })}`);
            if (placesRes.ok) {
              const pData = await placesRes.json();
              const extra = (pData.images || []).filter((u: string) => u && !usedUrls.has(u)).slice(0, remaining);
              extra.forEach((u: string) => usedUrls.add(u));
              return [...urls.slice(0, count - extra.length), ...extra];
            }
          } catch { /* return what we have */ }
          return urls.slice(0, count);
        }
      }
    } catch { /* fall through to Google Places */ }

    // Fallback: Google Places → Supabase Storage
    try {
      const placesRes = await fetch(`/api/places/photos?${new URLSearchParams({ query, count: String(count), tripId })}`);
      if (placesRes.ok) {
        const data = await placesRes.json();
        const urls = (data.images || []).filter((u: string) => u && !usedUrls.has(u)).slice(0, count);
        urls.forEach((u: string) => usedUrls.add(u));
        return urls;
      }
    } catch { /* return empty */ }

    return [];
  }

  // Fetch one unique image per query — search individually, take #1 result each time
  async function fetchOnePerQuery(queries: string[], tripId: string): Promise<string[]> {
    const results: string[] = [];
    for (const q of queries) {
      const imgs = await fetchSlideImages(q, tripId, 1);
      if (imgs.length > 0) results.push(imgs[0]);
    }
    return results;
  }

  // Stage 2 of the photo gate: ask the AI vision judge to score one image for a job (0-100).
  const STOP_CONFIDENCE = 70;
  async function judgeOne(url: string, job: string): Promise<number> {
    try {
      const res = await fetch("/api/photos/judge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images: [url], job }),
      });
      if (res.ok) {
        const d = await res.json();
        return Array.isArray(d.scores) && d.scores.length > 0 ? (Number(d.scores[0]) || 0) : 0;
      }
    } catch { /* treat as fail */ }
    return 0;
  }
  const params = useParams();
  const tripId = params.tripId as string;
  const [trip, setTrip] = useState<Trip | null>(null);
  const [, setMember] = useState<TripMember | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [totalDays, setTotalDays] = useState(0);
  const [generatedDays, setGeneratedDays] = useState(0);
  const [phase, setPhase] = useState<"cinematic" | "tour">("cinematic");
  const [generationDone, setGenerationDone] = useState(false);
  const [hypeReady, setHypeReady] = useState(false);
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    async function curate() {
      // Capture when curate starts — used to calculate how much cinematic time has elapsed
      const curateStartTime = Date.now();

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

      const chunkSize = 2;
      const chunks = Math.ceil(total / chunkSize);
      const dayColors = generateDayColors(total);
      const summaries: GeneratedDaySummary[] = [];
      let saved = 0;

      // Wait for map cinematic animation to finish before fetching hype images
      // This prevents network contention during the cinematic and ensures smooth animation
      const CINEMATIC_DURATION = 6000;
      const elapsedSoFar = Date.now() - curateStartTime;
      const cinematicWait = Math.max(0, CINEMATIC_DURATION - elapsedSoFar);
      if (cinematicWait > 0) {
        await new Promise(resolve => setTimeout(resolve, cinematicWait));
      }

      // Fetch hype slide images AFTER cinematic — specific evocative queries per image
      // Each query targets a different visual mood; one search per photo = curated feel
      try {
        const destName = dest;
        // Extract cities if destination has multiple (e.g. "Rome, Florence, Amalfi Coast")
        const destCities = dest.split(/[,&]/).map((s: string) => s.trim()).filter(Boolean);
        const primaryCity = destCities[0] || dest;
        const secondaryCity = destCities.length > 1 ? destCities[1] : primaryCity;

        // Destination hype: iconic landmarks, aerial views, atmosphere
        const destQueries = [
          `${primaryCity} iconic landmark travel`,
          `${secondaryCity} aerial cityscape panorama`,
          `${primaryCity} sunset golden hour`,
          `${destName} scenic landscape travel photography`,
          `${secondaryCity} architecture historic`,
        ];

        // Food hype: atmosphere of eating, not food close-ups
        const foodQueries = [
          `${primaryCity} outdoor restaurant terrace dining`,
          `${destName} local market fresh produce`,
          `${primaryCity} cafe street scene`,
          `${secondaryCity} traditional cuisine restaurant interior`,
          `${destName} food market atmosphere`,
        ];

        // Hidden gems hype: narrow streets, unexpected beauty, local life
        const gemsQueries = [
          `${primaryCity} cobblestone alley narrow street`,
          `${secondaryCity} hidden courtyard local neighborhood`,
          `${destName} secret garden viewpoint`,
          `${primaryCity} off beaten path local scene`,
          `${secondaryCity} quiet piazza morning light`,
        ];

        const [destImgs, foodImgs, gemsImgs] = await Promise.all([
          fetchOnePerQuery(destQueries, tripId),
          fetchOnePerQuery(foodQueries, tripId),
          fetchOnePerQuery(gemsQueries, tripId),
        ]);

        const allImages = [
          ...destImgs.slice(0, 5),
          ...foodImgs.slice(0, 5),
          ...gemsImgs.slice(0, 5),
        ];

        // Photo-thin destination? Top up from the curated regional mood shelf (the Peoria fix).
        // One tiny classification call, only when search came back thin.
        if (allImages.length < 8) {
          try {
            const regionRes = await fetch("/api/ai/chat", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                messages: [{ role: "user", content: `Classify the dominant landscape of a trip to "${dest}" as exactly one of: midwest-river, midwest-farmland, great-lakes, plains, mountain-west, desert-southwest, southeast, new-england, pacific-northwest, gulf-coast, international, other. Reply with only the key, nothing else.` }],
                systemPrompt: "You classify US trip destinations into landscape regions. Reply with only the single requested key.",
                max_tokens: 16,
              }),
            });
            const regionData = await regionRes.json();
            const regionBlocks: Array<{ type: string; text?: string }> = Array.isArray(regionData.content) ? regionData.content : [];
            const regionKey = regionBlocks.filter(b => b.type === "text").map(b => b.text || "").join("").trim().toLowerCase();
            if (regionKey && regionKey !== "other" && regionKey !== "international") {
              const { data: shelf } = await supabase.from("photo_library").select("url")
                .eq("kind", "region").eq("key", regionKey).eq("approved", true).limit(15);
              for (const shelfImg of shelf || []) {
                if (allImages.length >= 15) break;
                if (!allImages.includes(shelfImg.url) && !usedUrls.has(shelfImg.url)) {
                  allImages.push(shelfImg.url);
                  usedUrls.add(shelfImg.url);
                }
              }
            }
          } catch { /* proceed with what we have */ }
        }

        if (allImages.length > 0) {
          // F-076: keyed slide image groups — each slide type reads its own photos by name, not position
          await supabase.from("trips").update({ slide_images: { hype: allImages, cities: {}, final: [] } }).eq("id", tripId);
        }
        setHypeReady(true);
      } catch (err) {
        console.error("Hype image fetch failed:", err);
        setHypeReady(true);
      }

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

            // Fetch slide images per-stop: search individually for top visual elements, take #1 each
            const dayStops = dayData.stops || [];
            const dayCity = dayData.title.split(/[—\-,]/)[0].trim();

            // Extract searchable keywords from the day title (e.g. "Greenwich Village & SoHo" → ["Greenwich Village", "SoHo"])
            const titleKeywords = dayData.title
              .split(/[—\-,&]/)
              .map((s: string) => s.trim())
              .filter((s: string) => s.length > 2 && !/^day\s*\d/i.test(s));

            // Build smart queries: anchor stops first, then title keywords, skip restaurant names
            const visualStops = dayStops
              .filter(s => s.stop_type !== "transit" && s.stop_type !== "food")
              .sort((a, b) => (b.is_anchor ? 1 : 0) - (a.is_anchor ? 1 : 0));
            const foodStops = dayStops.filter(s => s.stop_type === "food");

            const stopQueries: string[] = [];

            // Priority 1: anchor non-food stops by name + city
            for (const s of visualStops.slice(0, 2)) {
              stopQueries.push(`${s.name} ${dayCity || dest}`);
            }

            // Priority 2: title keywords (neighborhoods, landmarks mentioned in the title)
            if (stopQueries.length < 3) {
              for (const kw of titleKeywords) {
                if (stopQueries.length >= 3) break;
                // Skip if we already have a query containing this keyword
                const kwLower = kw.toLowerCase();
                const alreadyCovered = stopQueries.some(q => q.toLowerCase().includes(kwLower));
                if (!alreadyCovered) {
                  stopQueries.push(`${kw} ${dest} travel`);
                }
              }
            }

            // Priority 3: fallback for days with few visual stops
            if (stopQueries.length < 2) {
              if (dayCity && dayCity.toLowerCase() !== dest.toLowerCase()) {
                stopQueries.push(`${dayCity} landmark travel photography`);
              } else {
                stopQueries.push(`${dest} scenic travel`);
              }
            }

            // Priority 4: food-only days — use neighborhood atmosphere
            if (stopQueries.length === 0 && foodStops.length > 0) {
              stopQueries.push(`${dayCity || dest} dining district street scene`);
              stopQueries.push(`${dayCity || dest} food market atmosphere`);
            }

            const slideImages = await fetchOnePerQuery(stopQueries.slice(0, 3), tripId);

            const { data: dayRow } = await supabase.from("days").insert({
              trip_id: tripId,
              day_number: dayData.day_number,
              title: dayData.title,
              color,
              narrative: dayData.narrative || null,
              reasoning: dayData.reasoning || null,
              vibe_status: "locked",
              slide_images: slideImages.length > 0 ? slideImages : [],
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
              const { data: insertedStops } = await supabase.from("stops").insert(stopRows).select();
              // Two-stage photo gate, one real photo per stop:
              // Stage 1 (source triage): Google Places venue photo → Commons by coordinates → curated shelf.
              // Stage 2 (AI vision pass): Places/Commons candidates must clear a confidence score to be saved;
              // if neither clears, fall back to the shelf (already vision-vetted at seed time); else save nothing.
              // Fire-and-forget: generation speed is unaffected.
              if (insertedStops && insertedStops.length > 0) {
                (async () => {
                  const rows = insertedStops as Stop[];
                  for (let k = 0; k < rows.length; k++) {
                    const row = rows[k];
                    if (row.stop_type === "transit") continue;
                    const srcStop = stops[k]?.name === row.name ? stops[k] : stops.find(s => s.name === row.name);
                    const recognitionJob = `This image should show "${row.name}" in ${dayCity || dest} — the actual place: its storefront, sign, entrance, or a clearly identifiable real view of it. A generic stock photo, a wrong subject, or an unrelated scene should score low.`;
                    let saved = false;

                    // Tier 1: Google Places — photo of the actual venue, gated by vision
                    try {
                      const res = await fetch(`/api/places/photos?${new URLSearchParams({ query: `${row.name} ${dayCity || dest}`, count: "1", tripId })}`);
                      if (res.ok) {
                        const d = await res.json();
                        const url: string | undefined = (d.images || [])[0];
                        if (url && (await judgeOne(url, recognitionJob)) >= STOP_CONFIDENCE) {
                          await supabase.from("stops").update({ photos: [{ url }] }).eq("id", row.id);
                          saved = true;
                        }
                      }
                    } catch { /* fall through */ }

                    // Tier 1.5: Wikimedia Commons — real photos near the coordinates, gated by vision
                    if (!saved && row.latitude && row.longitude) {
                      try {
                        const res = await fetch(`/api/commons/photos?${new URLSearchParams({ lat: String(row.latitude), lng: String(row.longitude), radius: "1000", count: "1" })}`);
                        if (res.ok) {
                          const d = await res.json();
                          const img = (d.images || [])[0];
                          if (img?.url && (await judgeOne(img.url, recognitionJob)) >= STOP_CONFIDENCE) {
                            await supabase.from("stops").update({ photos: [{ url: img.url, attribution: img.attribution }] }).eq("id", row.id);
                            saved = true;
                          }
                        }
                      } catch { /* fall through */ }
                    }

                    // Tier 2: curated category shelf — already vision-vetted at seed time (a mood stand-in, not the venue)
                    if (!saved && srcStop?.photo_category) {
                      try {
                        const { data: shelf } = await supabase.from("photo_library").select("url, attribution")
                          .eq("kind", "category").eq("key", srcStop.photo_category).eq("approved", true).limit(5);
                        if (shelf && shelf.length > 0) {
                          const pick = shelf[Math.floor(Math.random() * shelf.length)];
                          await supabase.from("stops").update({ photos: [{ url: pick.url, attribution: pick.attribution || undefined }] }).eq("id", row.id);
                        }
                      } catch { /* leave photos empty */ }
                    }
                  }
                })();
              }
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

      // ── Post-generation: fetch city arrival + final slide images ──
      // Detect distinct cities from generated days and add dedicated photos for arrival slides
      try {
        const cityNames = new Set<string>();
        const cityList: string[] = [];
        for (const s of summaries) {
          const city = s.title.split(/[—\-,]/)[0].trim();
          if (city && !cityNames.has(city.toLowerCase())) {
            cityNames.add(city.toLowerCase());
            cityList.push(city);
          }
        }

        // F-076: keyed slide image groups — city and final photos stored under their own keys
        const cityMap: Record<string, string[]> = {};

        // City arrival images — 2 per distinct city (only matters for multi-city trips)
        if (cityList.length >= 2) {
          for (const city of cityList) {
            const cityImgs = await fetchOnePerQuery([
              `${city} skyline travel panorama`,
              `${city} iconic landmark aerial`,
            ], tripId);
            if (cityImgs.length > 0) cityMap[city] = cityImgs;
          }
        }

        // Final slide — 1 cinematic closing image
        const finalImg = await fetchOnePerQuery([
          `${dest} panorama sunset skyline`,
        ], tripId);

        // Merge into keyed slide_images (legacy flat arrays become the hype group)
        if (Object.keys(cityMap).length > 0 || finalImg.length > 0) {
          const { data: currentTrip } = await supabase.from("trips").select("slide_images").eq("id", tripId).maybeSingle();
          const cur = currentTrip?.slide_images;
          const hype: string[] = Array.isArray(cur) ? cur : (cur && typeof cur === "object" ? ((cur as { hype?: string[] }).hype || []) : []);
          await supabase.from("trips").update({ slide_images: { hype, cities: cityMap, final: finalImg } }).eq("id", tripId);
        }
      } catch (err) {
        console.error("City/final image fetch failed:", err);
      }

      try {
        const summaryRes = await fetch("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [{ role: "user", content: `Based on the itinerary you just built across ${total} days for ${group} going to ${dest}, write an exciting 3-4 sentence trip summary paragraph. It should make them feel the trip before they see the details — an emotional preview, not a table of contents.\n\nDays:\n${summaries.map(s => `Day ${s.day_number} — ${s.title}`).join("\n")}` }],
            systemPrompt: "You are the trip's curator. Write short, vivid, opinionated trip summary paragraphs. Respond with just the paragraph text — no preamble, no JSON, no quotes.",
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

      // Mark generation complete
      setGenerationDone(true);
    }

    curate();
  }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps

  const dest = trip?.destination || "your destination";

  // Phase transitions — STRICTLY ONE-DIRECTIONAL
  // loading → cinematic → tour → workspace (never backwards)
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const cinematicStartRef = useRef<number>(0);
  const tourLaunched = useRef(false);

  // Set cinematic start time on mount
  useEffect(() => {
    cinematicStartRef.current = Date.now();
  }, []);

  // Track when first chunk of days is ready (one-shot: false → true)
  // (kept for potential future use but no longer gates tour launch)

  // Cinematic → tour when hype images are ready + minimum cinematic display time
  useEffect(() => {
    if (phase !== "cinematic" || tourLaunched.current || !hypeReady) return;

    const elapsed = Date.now() - cinematicStartRef.current;
    const minDuration = 6000;
    const remaining = Math.max(0, minDuration - elapsed);

    const timer = setTimeout(() => {
      if (tourLaunched.current) return;
      tourLaunched.current = true;
      if (phaseRef.current === "cinematic") {
        setPhase("tour");
      }
    }, remaining);

    return () => clearTimeout(timer);
  }, [phase, hypeReady]);

  // Handle tour completion — always redirect, never go back
  function handleTourComplete() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(`tour_seen_${tripId}`, "1");
    }
    router.push(`/trip/${tripId}`);
  }

  // Safety net: if generation finishes while still in cinematic (tour somehow didn't launch)
  useEffect(() => {
    if (generationDone && phase === "cinematic" && !tourLaunched.current) {
      // Force tour launch immediately
      tourLaunched.current = true;
      setPhase("tour");
    }
  }, [generationDone, phase]);
  if (error) return (
    <div className="h-screen flex items-center justify-center bg-white">
      <p className="text-red-500 text-center max-w-sm px-4">{error}</p>
    </div>
  );

  // ── PHASE: TOUR ──
  if (phase === "tour" && trip) {
    return (
      <TripTour
        tripId={tripId}
        trip={trip}
        onComplete={handleTourComplete}
        generationComplete={generationDone}
      />
    );
  }

  // ── PHASE: CINEMATIC ──
  if (phase === "cinematic") {
    return (
      <div className="h-screen relative" style={{ background: "#0a0a0a" }}>
        {trip && <MapCinematic tripId={tripId} destination={trip.destination || trip.name} refreshTrigger={generatedDays} />}

        {/* Curating overlay */}
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 10, textAlign: "center",
        }}>
          <div style={{
            width: 32, height: 32, borderRadius: "50%",
            border: "2.5px solid rgba(255,255,255,0.15)",
            borderTopColor: "rgba(255,255,255,0.6)",
            animation: "curateSpin 1.2s ease-in-out infinite",
            margin: "0 auto 16px",
          }} />
          <div style={{ fontSize: 15, fontWeight: 500, color: "rgba(255,255,255,0.7)", letterSpacing: 0.3 }}>
            I&apos;m curating your trip
          </div>
        </div>

        <style>{`
          @keyframes curateSpin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // ── PHASE: LOADING fallback ──
  return null;
}
