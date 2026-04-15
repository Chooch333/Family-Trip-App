"use client";
import { useEffect, useCallback, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { generateDayColors } from "@/lib/tripHelpers";
import type { Trip, Day, Stop } from "@/lib/database.types";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

interface CardPosition {
  top: string; left: string; right: string; bottom: string;
}
interface SlideBase { bg: string; key: string; }
interface CenterSlide extends SlideBase {
  layout: "center"; label: string; headline: string; body: string;
  labelColor: string; buttons?: { primary: string; secondary?: string };
}
interface CardSlide extends SlideBase {
  layout: "card"; position: CardPosition; cardLabel: string;
  cardLabelColor: string; dayTitle: string; dayColor: string; body: string;
  stops: { name: string; meta: string; time: string; isAnchor: boolean; color: string; }[];
}
type Slide = CenterSlide | CardSlide;

interface TripTourProps {
  tripId: string;
  trip: Trip;
  onComplete: () => void;
  generationComplete: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITIONS & GRADIENTS
// ─────────────────────────────────────────────────────────────────────────────

const POS = {
  topLeft:     { top: "24px", left: "24px", right: "auto", bottom: "auto" },
  topRight:    { top: "24px", left: "auto", right: "24px", bottom: "auto" },
  bottomRight: { top: "auto", left: "auto", right: "24px", bottom: "24px" },
  bottomLeft:  { top: "auto", left: "24px", right: "auto", bottom: "24px" },
  topLeftLow:  { top: "60px", left: "24px", right: "auto", bottom: "auto" },
};
const TOP_POSITIONS = [POS.topLeft, POS.topRight, POS.topLeftLow];
const ANY_POSITIONS = [POS.topLeft, POS.topRight, POS.bottomRight, POS.bottomLeft, POS.topLeftLow];

function pickPosition(candidates: CardPosition[], lastUsed: CardPosition | null): CardPosition {
  const available = lastUsed
    ? candidates.filter(p => p.top !== lastUsed.top || p.left !== lastUsed.left)
    : candidates;
  const pool = available.length > 0 ? available : candidates;
  return pool[Math.floor(Math.random() * pool.length)];
}

const GRADIENTS = [
  "linear-gradient(160deg, #5a3a1a, #8a6a3a, #4a2a0a)",
  "linear-gradient(160deg, #1a2a4a, #2a3a5a, #0a1a3a)",
  "linear-gradient(160deg, #2a4a2a, #4a6a3a, #1a3a1a)",
  "linear-gradient(135deg, #3a1a0a, #6a3a1a, #2a1508)",
  "linear-gradient(135deg, #2a2a3a, #3a2a4a, #1a1a2a)",
  "linear-gradient(160deg, #1a3a4a, #2a4a5a, #0a2a3a)",
  "linear-gradient(135deg, #4a3018, #8a6a3a, #3a2010)",
  "linear-gradient(160deg, #3a2a1a, #6a4a2a, #2a1a0a)",
];
function getGradient(i: number) { return GRADIENTS[i % GRADIENTS.length]; }

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getDistinctCities(days: Day[]) {
  const seen = new Set<string>();
  const cities: { city: string; firstDayIndex: number }[] = [];
  for (let i = 0; i < days.length; i++) {
    const title = (days[i].title || "").trim();
    const city = title.split(/[—\-,]/)[0].trim();
    if (city && !seen.has(city.toLowerCase())) {
      seen.add(city.toLowerCase());
      cities.push({ city, firstDayIndex: i });
    }
  }
  return cities;
}

function formatTime12(time: string | null): string {
  if (!time) return "";
  const parts = time.slice(0, 5).split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12; else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

function buildGroupRef(trip: Trip): string {
  const gt = (trip.group_type || "").toLowerCase();
  const detail = trip.group_detail || "";
  if (gt === "family") return detail ? "your family" : "the family";
  if (gt === "couple") return "you two";
  if (gt === "friends") return "the crew";
  return "you";
}

// ─────────────────────────────────────────────────────────────────────────────
// HYPE SLIDE TEXT BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

function extractSeason(travelDates: string): string | null {
  const lower = (travelDates || "").toLowerCase();
  const monthMap: Record<string, string> = {
    jan: "winter", feb: "winter", mar: "spring", apr: "spring",
    may: "late spring", jun: "early summer", jul: "summer", aug: "summer",
    sep: "early fall", oct: "fall", nov: "late fall", dec: "winter",
  };
  for (const [abbr, season] of Object.entries(monthMap)) {
    if (lower.includes(abbr)) return season;
  }
  return null;
}

function extractKidsInfo(groupDetail: string): { hasKids: boolean; ages: string[] } {
  if (!groupDetail) return { hasKids: false, ages: [] };
  const ageMatch = groupDetail.match(/ages?\s*([\d,\s]+(?:and\s+\d+)?)/i);
  if (ageMatch) {
    const ages = ageMatch[1].replace(/and/g, ",").split(",").map(s => s.trim()).filter(Boolean);
    return { hasKids: true, ages };
  }
  if (/kid|child|children/i.test(groupDetail)) return { hasKids: true, ages: [] };
  return { hasKids: false, ages: [] };
}

function buildDestinationHype(trip: Trip): string {
  const dest = trip.destination || trip.name;
  const groupRef = buildGroupRef(trip);
  const season = extractSeason(trip.travel_dates || "");
  const kids = extractKidsInfo(trip.group_detail || "");
  const interests = (trip.interests || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const extraNotes = trip.extra_notes || "";
  const gt = (trip.group_type || "").toLowerCase();

  const parts: string[] = [];

  // Season-aware opener
  if (season) {
    parts.push(`${dest} in ${season} is a different experience than most travelers get.`);
    if (season.includes("summer")) {
      parts.push(`The days are long, the energy is high, and ${groupRef} will feel it the moment you step outside.`);
    } else if (season.includes("spring")) {
      parts.push(`The crowds haven't descended yet, the weather is on your side, and ${groupRef} will have room to breathe at every stop.`);
    } else if (season.includes("fall")) {
      parts.push(`The light changes, the tourist rush fades, and the locals start to reclaim their city. That's when ${dest} shows you what it's really about.`);
    } else if (season.includes("winter")) {
      parts.push(`Fewer crowds, sharper light, and the kind of atmosphere that makes every warm café feel like a discovery. ${groupRef.charAt(0).toUpperCase() + groupRef.slice(1)} will get a version of ${dest} most people never see.`);
    }
  } else {
    parts.push(`I've been thinking about what makes ${dest} work specifically for ${groupRef}.`);
  }

  // Kids-specific line
  if (kids.hasKids && kids.ages.length > 0) {
    const youngest = Math.min(...kids.ages.map(Number).filter(n => !isNaN(n)));
    const oldest = Math.max(...kids.ages.map(Number).filter(n => !isNaN(n)));
    if (youngest && oldest && youngest !== oldest) {
      parts.push(`I'm building this for ages ${youngest} through ${oldest} — which means every stop has to work for someone who wants to run ahead AND someone who might need to be carried home.`);
    } else if (youngest) {
      parts.push(`With a ${youngest}-year-old in the mix, the pacing matters as much as the places. I've built in breathing room.`);
    }
  } else if (gt === "couple") {
    parts.push(`This isn't a checklist trip. I'm building something with the kind of pace where you actually talk to each other at dinner.`);
  }

  // Interests weave
  if (interests.length >= 2) {
    parts.push(`You said ${interests.slice(0, 3).join(", ")} — I'm weaving all of that in, not as separate line items, but as the connective tissue of each day.`);
  } else if (interests.length === 1) {
    parts.push(`You mentioned ${interests[0]} — that's not a sidebar, it's the throughline.`);
  }

  // Extra notes nod
  if (extraNotes && extraNotes.length > 5) {
    if (/first time/i.test(extraNotes)) {
      parts.push(`And since this is your first time — I'm going to make sure you hit the moments that matter without drowning in a 47-stop itinerary.`);
    } else if (/dog|pet/i.test(extraNotes)) {
      parts.push(`Your dog is part of the trip — I've kept that in mind for every outdoor stop and transit decision.`);
    }
  }

  // Fallback if we ended up with only one line
  if (parts.length < 2) {
    parts.push(`Not a highlight reel. A real trip, built around how ${groupRef} actually travel.`);
  }

  return parts.join(" ");
}

function buildFoodHype(trip: Trip): string {
  const dest = trip.destination || trip.name;
  const groupRef = buildGroupRef(trip);
  const kids = extractKidsInfo(trip.group_detail || "");
  const gt = (trip.group_type || "").toLowerCase();
  const interests = (trip.interests || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  const hasFood = interests.includes("food") || interests.includes("cuisine") || interests.includes("cooking");

  const parts: string[] = [];

  // Philosophy opener — destination-aware
  const destLower = dest.toLowerCase();
  if (/italy|rome|florence|naples|amalfi/i.test(destLower)) {
    parts.push(`In Italy, the best meals find you — but only if you're in the right neighborhood at the right time.`);
    parts.push(`I'm not sending ${groupRef} to the places with laminated English menus on the sidewalk.`);
  } else if (/france|paris|lyon|provence/i.test(destLower)) {
    parts.push(`French food isn't about finding the Michelin star — it's about the corner brasserie that's been open since before your parents were born.`);
  } else if (/japan|tokyo|kyoto|osaka/i.test(destLower)) {
    parts.push(`In Japan, the food is the trip. The ¥800 ramen counter with six stools and no sign is better than most restaurants you've been to.`);
  } else if (/mexico|oaxaca|cdmx/i.test(destLower)) {
    parts.push(`The food here isn't a restaurant experience — it's a street experience. The best things you'll eat will cost less than a dollar and come from someone who's been making the same thing for thirty years.`);
  } else {
    parts.push(`Here's my approach to food on this trip: every meal should feel like it belongs where you already are that day.`);
    parts.push(`No detours across town for a trending restaurant. The food follows the route.`);
  }

  // Family-specific food line
  if (kids.hasKids) {
    const ages = kids.ages.map(Number).filter(n => !isNaN(n));
    const youngest = ages.length > 0 ? Math.min(...ages) : null;
    if (youngest && youngest <= 5) {
      parts.push(`Every food stop has something a ${youngest}-year-old will point at and say yes — no negotiations required.`);
    } else if (youngest && youngest <= 10) {
      parts.push(`I'm picking places where kids can actually eat, not places where they sit quietly and stare at a prix fixe menu.`);
    } else {
      parts.push(`Your kids are old enough to eat the real food here — and I'm going to make sure they get the chance.`);
    }
  } else if (gt === "couple") {
    parts.push(`I'll mix in a couple of dinner spots worth getting dressed for — but some of the best meals will be the ones you didn't plan.`);
  }

  // Food interest acknowledgment
  if (hasFood) {
    parts.push(`You flagged food as an interest — so I'm going deeper than "good restaurant near your hotel." Expect places with a story.`);
  }

  return parts.join(" ");
}

function buildGemsHype(trip: Trip): string {
  const dest = trip.destination || trip.name;
  const groupRef = buildGroupRef(trip);
  const kids = extractKidsInfo(trip.group_detail || "");
  const gt = (trip.group_type || "").toLowerCase();

  const parts: string[] = [];

  parts.push(`This is the part I'm most excited about.`);
  parts.push(`Anyone can Google "top 10 things to do in ${dest}." I'm going to show ${groupRef} the stops most people walk right past.`);

  // Group-specific angle
  if (kids.hasKids && kids.ages.length > 0) {
    parts.push(`The kind of places where your kids will remember the weird little detail — the fountain, the cat, the gelato window — twenty years from now.`);
  } else if (gt === "couple") {
    parts.push(`A side street with no one else on it. A viewpoint the tour buses can't reach. The kind of moments you'll reference for years.`);
  } else if (gt === "friends") {
    parts.push(`The spots that become inside jokes and group chat names. That's what I'm looking for.`);
  } else {
    parts.push(`Timing tricks, neighborhood knowledge, the local rhythm — the things that turn a trip into a story worth telling.`);
  }

  parts.push(`That's the kind of trip I build.`);

  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE BUILDERS — separated so day slides grow independently of wrap-up
// ─────────────────────────────────────────────────────────────────────────────

function buildDaySlides(
  trip: Trip, days: Day[], stops: Stop[], dayColors: string[]
): Slide[] {
  const slides: Slide[] = [];
  let gradientIdx = 0;
  let lastCardPos: CardPosition | null = null;

  // ── Hype slides — personality-driven, render from trip metadata immediately ──

  // Destination showcase
  const destHeadline = trip.destination || trip.name;
  slides.push({
    layout: "center", key: "hype-destination",
    bg: "linear-gradient(160deg, #1a3a4a 0%, #0a2a3a 50%, #2a4a5a 100%)",
    label: "THE DESTINATION", labelColor: "#5DCAA5",
    headline: destHeadline,
    body: buildDestinationHype(trip),
  });
  gradientIdx++;

  // Food philosophy
  slides.push({
    layout: "center", key: "hype-food",
    bg: "linear-gradient(135deg, #3a1a0a 0%, #6a3a1a 50%, #4a2a10 100%)",
    label: "THE FOOD PHILOSOPHY", labelColor: "#D85A30",
    headline: "Here's how I'm thinking about food.",
    body: buildFoodHype(trip),
  });
  gradientIdx++;

  // Hidden gems preview
  slides.push({
    layout: "center", key: "hype-gems",
    bg: "linear-gradient(160deg, #2a1a3a 0%, #3a2a4a 50%, #1a1a2a 100%)",
    label: "HIDDEN GEMS", labelColor: "#AFA9EC",
    headline: "I'm going to show you things most people walk right past.",
    body: buildGemsHype(trip),
  });
  gradientIdx++;

  // ── City & day slides — grow as chunks land from Supabase ──

  const cities = getDistinctCities(days);
  const multiCity = cities.length >= 2;

  // Best anchor spotlight
  const anchoredStops = stops.filter(s => s.is_anchor && s.stop_type !== "transit");
  const bestAnchor = [...anchoredStops].sort((a, b) => (b.ai_note || "").length - (a.ai_note || "").length)[0];

  for (let ci = 0; ci < cities.length; ci++) {
    const city = cities[ci];
    const nextCityStart = ci + 1 < cities.length ? cities[ci + 1].firstDayIndex : days.length;
    const cityDays = days.slice(city.firstDayIndex, nextCityStart);

    // City arrival (multi-city only)
    if (multiCity) {
      const arrivalLabel = ci === 0 ? "First stop" : ci === cities.length - 1 ? "Final destination" : "Next up";
      slides.push({
        layout: "center", key: `city-${city.city}`,
        bg: getGradient(gradientIdx++),
        label: arrivalLabel, labelColor: "#D85A30",
        headline: city.city,
        body: cityDays[0]?.narrative || `${cityDays.length} day${cityDays.length > 1 ? "s" : ""} in ${city.city}.`,
      });
    }

    // Anchor spotlight (first occurrence in this city)
    if (bestAnchor) {
      const anchorDay = days.find(d => d.id === bestAnchor.day_id);
      const anchorDayIdx = anchorDay ? days.indexOf(anchorDay) : -1;
      if (anchorDayIdx >= city.firstDayIndex && anchorDayIdx < nextCityStart) {
        const pos = pickPosition(ANY_POSITIONS, lastCardPos);
        lastCardPos = pos;
        slides.push({
          layout: "card", key: `anchor-${bestAnchor.id}`,
          bg: getGradient(gradientIdx++), position: pos,
          cardLabel: "Anchor spotlight", cardLabelColor: "#1D9E75",
          dayTitle: bestAnchor.name,
          dayColor: dayColors[anchorDayIdx] || "#1D9E75",
          body: [bestAnchor.description, bestAnchor.ai_note].filter(Boolean).join(" "),
          stops: [],
        });
      }
    }

    // Day overviews
    for (const day of cityDays) {
      const dayIdx = days.indexOf(day);
      const dayColor = dayColors[dayIdx] || "#1D9E75";
      const dayStops = stops.filter(s => s.day_id === day.id && s.stop_type !== "transit")
        .sort((a, b) => a.sort_order - b.sort_order);
      if (dayStops.length === 0) continue;

      const displayStops = dayStops.length > 5
        ? [...dayStops.filter(s => s.is_anchor), ...dayStops.filter(s => !s.is_anchor)].slice(0, 5)
        : dayStops;

      const hasTransit = stops.some(s => s.day_id === day.id && s.stop_type === "transit");
      const label = hasTransit ? `Day ${day.day_number} — The gear shift` : `Day ${day.day_number}`;
      const narrative = day.narrative || "";
      const reasoning = (day as Day & { reasoning?: string }).reasoning || "";
      const body = reasoning && narrative ? `${narrative} ${reasoning}` : narrative || reasoning || "";

      const pos = pickPosition(displayStops.length >= 4 ? TOP_POSITIONS : ANY_POSITIONS, lastCardPos);
      lastCardPos = pos;

      slides.push({
        layout: "card", key: `day-${day.id}`,
        bg: getGradient(gradientIdx++), position: pos,
        cardLabel: label, cardLabelColor: dayColor,
        dayTitle: day.title || `Day ${day.day_number}`, dayColor, body,
        stops: displayStops.map(s => ({
          name: s.name,
          meta: `${s.stop_type} · ${s.duration_minutes} min`,
          time: formatTime12(s.start_time),
          isAnchor: !!s.is_anchor,
          color: dayColor,
        })),
      });
    }
  }

  return slides;
}

function buildWrapUpSlides(trip: Trip, stops: Stop[]): Slide[] {
  const slides: Slide[] = [];
  const groupRef = buildGroupRef(trip);
  let gradientIdx = 20; // offset to avoid repeating day gradients

  // Food narrative
  const foodStops = stops.filter(s => s.stop_type === "food");
  if (foodStops.length >= 3) {
    const foodNames = foodStops.slice(0, 5).map(s => s.name);
    slides.push({
      layout: "center", key: "food",
      bg: getGradient(gradientIdx++),
      label: "How I'm feeding you", labelColor: "#D85A30",
      headline: "The food plan",
      body: foodStops.length >= 5
        ? `Every food stop is chosen for where ${groupRef} will already be that day. ${foodNames.slice(0, 3).join(", ")} — each one picked because it's walkable from your main stops, not because it topped some list.`
        : `I picked ${foodNames.join(" and ")} specifically for ${groupRef} — they're all walkable from whatever you're doing that day.`,
    });
  }

  // Hidden gem
  const hiddenGem = stops
    .filter(s => !s.is_anchor && s.ai_note && s.ai_note.length > 20 && s.stop_type !== "transit")
    .sort((a, b) => (b.ai_note || "").length - (a.ai_note || "").length)[0];
  if (hiddenGem) {
    slides.push({
      layout: "center", key: "gem",
      bg: getGradient(gradientIdx++),
      label: "The one you'd miss", labelColor: "#AFA9EC",
      headline: hiddenGem.name,
      body: hiddenGem.ai_note || hiddenGem.description || "This one isn't in the guidebooks the way it should be.",
    });
  }

  // Closer
  slides.push({
    layout: "center", key: "closer",
    bg: "linear-gradient(135deg, #1a2a2a, #2a3a3a, #1a1a2a)",
    label: "That's the shape of it", labelColor: "#5DCAA5",
    headline: "Ready to make it yours?",
    body: "The anchored stops are locked. Everything else is yours to change — swap restaurants, add a detour, trim a packed day. Tell me what feels right and what doesn't.",
    buttons: { primary: "Start planning" },
  });

  return slides;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANCHOR ICON
// ─────────────────────────────────────────────────────────────────────────────

function AnchorSvg() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#0F6E56"
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="5" r="3" /><line x1="12" y1="8" x2="12" y2="21" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// COMPONENT — polls Supabase, grows slides as chunks land
// ─────────────────────────────────────────────────────────────────────────────

export default function TripTour({ tripId, trip, onComplete, generationComplete }: TripTourProps) {
  const [days, setDays] = useState<Day[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [current, setCurrent] = useState(0);
  const [cardVisible, setCardVisible] = useState(false);
  const prevDayCount = useRef(0);

  // Poll Supabase for new days/stops
  const fetchData = useCallback(async () => {
    const [daysRes, stopsRes] = await Promise.all([
      supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
      supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
    ]);
    if (daysRes.data) setDays(daysRes.data as Day[]);
    if (stopsRes.data) setStops(stopsRes.data as Stop[]);
  }, [tripId]);

  // Initial fetch
  useEffect(() => { fetchData(); }, [fetchData]);

  // Poll every 4s until generation is complete
  useEffect(() => {
    if (generationComplete) {
      // One final fetch to get everything including trip_summary
      fetchData();
      return;
    }
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [generationComplete, fetchData]);

  // Also re-fetch trip for trip_summary when generation completes
  const [currentTrip, setCurrentTrip] = useState(trip);
  useEffect(() => {
    if (!generationComplete) return;
    supabase.from("trips").select("*").eq("id", tripId).maybeSingle()
      .then(({ data }) => { if (data) setCurrentTrip(data as Trip); });
  }, [generationComplete, tripId]);

  // Build slides
  const dayColors = generateDayColors(days.length);
  const daySlides = buildDaySlides(currentTrip, days, stops, dayColors);
  const wrapUpSlides = generationComplete ? buildWrapUpSlides(currentTrip, stops) : [];
  const slides = [...daySlides, ...wrapUpSlides];

  // Track when new days arrive (for potential future use)
  useEffect(() => {
    if (days.length > prevDayCount.current) {
      prevDayCount.current = days.length;
    }
  }, [days.length]);

  const slide = slides[current];
  const isFirst = current === 0;
  const isLast = current === slides.length - 1;
  const atEndWaiting = isLast && !generationComplete;

  const goNext = useCallback(() => {
    if (current < slides.length - 1) {
      setCardVisible(false);
      setTimeout(() => setCurrent(c => c + 1), 50);
    }
  }, [current, slides.length]);

  const goPrev = useCallback(() => {
    if (current > 0) {
      setCardVisible(false);
      setTimeout(() => setCurrent(c => c - 1), 50);
    }
  }, [current]);

  // Card fade-in
  useEffect(() => {
    if (slide?.layout === "card") {
      const timer = setTimeout(() => setCardVisible(true), 100);
      return () => clearTimeout(timer);
    }
    setCardVisible(false);
  }, [current, slide?.layout]);

  // Keyboard
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === " ") goNext();
      if (e.key === "ArrowLeft") goPrev();
      if (e.key === "Escape") onComplete();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [goNext, goPrev, onComplete]);

  if (!slide || slides.length === 0) return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "#111",
      display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #333",
        borderTopColor: "#1D9E75", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "#111", overflow: "hidden" }}>
      {/* Backgrounds */}
      {slides.map((s, i) => (
        <div key={s.key} style={{
          position: "absolute", inset: 0, background: s.bg,
          opacity: i === current ? 1 : 0, transition: "opacity 0.7s ease",
        }} />
      ))}

      {/* Center slides */}
      {slides.map((s, i) => s.layout === "center" ? (
        <div key={s.key} style={{
          position: "absolute", inset: 0, display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40,
          opacity: i === current ? 1 : 0, transition: "opacity 0.5s ease",
          pointerEvents: i === current ? "auto" : "none", zIndex: 10,
        }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: s.labelColor,
            textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 16 }}>{s.label}</div>
          <div style={{ fontSize: 32, fontWeight: 500, color: "white",
            lineHeight: 1.2, marginBottom: 20 }}>{s.headline}</div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)",
            lineHeight: 1.7, marginBottom: 36, maxWidth: 460 }}>{s.body}</div>
          {s.buttons && (
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={isLast ? onComplete : () => {
                setCardVisible(false); setTimeout(() => setCurrent(current + 1), 50);
              }} style={{ padding: "13px 28px", borderRadius: 8, background: "#1D9E75",
                color: "white", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}>
                {s.buttons.primary}
              </button>
              {s.buttons.secondary && (
                <button onClick={onComplete} style={{ padding: "13px 28px", borderRadius: 8,
                  background: "rgba(255,255,255,0.08)", color: "rgba(255,255,255,0.75)",
                  fontSize: 14, fontWeight: 500, border: "0.5px solid rgba(255,255,255,0.15)", cursor: "pointer" }}>
                  {s.buttons.secondary}
                </button>
              )}
            </div>
          )}
        </div>
      ) : null)}

      {/* Floating card */}
      {slide.layout === "card" && (
        <div style={{
          position: "absolute", top: slide.position.top, left: slide.position.left,
          right: slide.position.right, bottom: slide.position.bottom, width: 380,
          background: "rgba(255,255,255,0.96)", borderRadius: 10, backdropFilter: "blur(10px)",
          zIndex: 10, overflow: "hidden", opacity: cardVisible ? 1 : 0,
          transition: "top 0.65s cubic-bezier(0.4,0,0.2,1), left 0.65s cubic-bezier(0.4,0,0.2,1), right 0.65s cubic-bezier(0.4,0,0.2,1), bottom 0.65s cubic-bezier(0.4,0,0.2,1), opacity 0.4s ease",
        }}>
          <div style={{ padding: "18px 20px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: slide.cardLabelColor,
              textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{slide.cardLabel}</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#1a1a1a", marginBottom: 10 }}>{slide.dayTitle}</div>
            {slide.body && (
              <div style={{ fontSize: 12, color: "#666", lineHeight: 1.6,
                marginBottom: slide.stops.length > 0 ? 12 : 0 }}>{slide.body}</div>
            )}
          </div>
          {slide.stops.length > 0 && (
            <div style={{ padding: "0 20px 16px" }}>
              {slide.stops.map((s, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
                  <div style={{ width: s.isAnchor ? 6 : 3, height: 24, borderRadius: 2,
                    background: s.color, opacity: s.isAnchor ? 1 : 0.25, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1a" }}>{s.name}</div>
                    <div style={{ fontSize: 10, color: "#999" }}>{s.meta}</div>
                  </div>
                  {s.time && <div style={{ fontSize: 10, color: "#bbb", whiteSpace: "nowrap", marginRight: 4 }}>{s.time}</div>}
                  {s.isAnchor && <div style={{ flexShrink: 0 }}><AnchorSvg /></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Nav arrows */}
      {!isFirst && (
        <button onClick={goPrev} style={{
          position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)",
          width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.2)",
          backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", zIndex: 30, color: "white", fontSize: 18, border: "none",
        }}>‹</button>
      )}
      {!isLast && (
        <button onClick={goNext} style={{
          position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
          width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.2)",
          backdropFilter: "blur(4px)", display: "flex", alignItems: "center",
          justifyContent: "center", cursor: "pointer", zIndex: 30, color: "white", fontSize: 18, border: "none",
        }}>›</button>
      )}

      {/* At end, waiting for more data — show subtle loading indicator instead of right arrow */}
      {atEndWaiting && (
        <div style={{
          position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)",
          width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.15)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30,
        }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)",
            borderTopColor: "rgba(255,255,255,0.5)", animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Counter */}
      <div style={{
        position: "absolute", bottom: 20, right: 24, fontSize: 11,
        color: "rgba(255,255,255,0.4)", zIndex: 20, fontWeight: 500,
      }}>
        {current + 1} / {slides.length}{!generationComplete ? "+" : ""}
      </div>
    </div>
  );
}