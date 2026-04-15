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
interface SlideBase { bg: string; key: string; images?: string[]; }
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
// DETERMINISTIC CARD POSITIONS — stable across renders
// ─────────────────────────────────────────────────────────────────────────────

const CARD_POSITIONS: CardPosition[] = [
  { top: "24px", left: "24px", right: "auto", bottom: "auto" },
  { top: "24px", left: "auto", right: "24px", bottom: "auto" },
  { top: "auto", left: "auto", right: "24px", bottom: "24px" },
  { top: "auto", left: "24px", right: "auto", bottom: "24px" },
  { top: "60px", left: "24px", right: "auto", bottom: "auto" },
];

function getCardPosition(index: number): CardPosition {
  return CARD_POSITIONS[index % CARD_POSITIONS.length];
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
  if (season) {
    parts.push(`${dest} in ${season} is a different experience than most travelers get.`);
    if (season.includes("summer")) parts.push(`The days are long, the energy is high, and ${groupRef} will feel it the moment you step outside.`);
    else if (season.includes("spring")) parts.push(`The crowds haven't descended yet, the weather is on your side, and ${groupRef} will have room to breathe at every stop.`);
    else if (season.includes("fall")) parts.push(`The light changes, the tourist rush fades, and the locals start to reclaim their city. That's when ${dest} shows you what it's really about.`);
    else if (season.includes("winter")) parts.push(`Fewer crowds, sharper light, and the kind of atmosphere that makes every warm café feel like a discovery. ${groupRef.charAt(0).toUpperCase() + groupRef.slice(1)} will get a version of ${dest} most people never see.`);
  } else {
    parts.push(`I've been thinking about what makes ${dest} work specifically for ${groupRef}.`);
  }
  if (kids.hasKids && kids.ages.length > 0) {
    const youngest = Math.min(...kids.ages.map(Number).filter(n => !isNaN(n)));
    const oldest = Math.max(...kids.ages.map(Number).filter(n => !isNaN(n)));
    if (youngest && oldest && youngest !== oldest) parts.push(`I'm building this for ages ${youngest} through ${oldest} — which means every stop has to work for someone who wants to run ahead AND someone who might need to be carried home.`);
    else if (youngest) parts.push(`With a ${youngest}-year-old in the mix, the pacing matters as much as the places. I've built in breathing room.`);
  } else if (gt === "couple") {
    parts.push(`This isn't a checklist trip. I'm building something with the kind of pace where you actually talk to each other at dinner.`);
  }
  if (interests.length >= 2) parts.push(`You said ${interests.slice(0, 3).join(", ")} — I'm weaving all of that in, not as separate line items, but as the connective tissue of each day.`);
  else if (interests.length === 1) parts.push(`You mentioned ${interests[0]} — that's not a sidebar, it's the throughline.`);
  if (extraNotes && extraNotes.length > 5) {
    if (/first time/i.test(extraNotes)) parts.push(`And since this is your first time — I'm going to make sure you hit the moments that matter without drowning in a 47-stop itinerary.`);
    else if (/dog|pet/i.test(extraNotes)) parts.push(`Your dog is part of the trip — I've kept that in mind for every outdoor stop and transit decision.`);
  }
  if (parts.length < 2) parts.push(`Not a highlight reel. A real trip, built around how ${groupRef} actually travel.`);
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
  const destLower = dest.toLowerCase();
  if (/italy|rome|florence|naples|amalfi/i.test(destLower)) {
    parts.push(`In Italy, the best meals find you — but only if you're in the right neighborhood at the right time.`);
    parts.push(`I'm not sending ${groupRef} to the places with laminated English menus on the sidewalk.`);
  } else if (/france|paris|lyon|provence/i.test(destLower)) {
    parts.push(`French food isn't about finding the Michelin star — it's about the corner brasserie that's been open since before your parents were born.`);
  } else if (/japan|tokyo|kyoto|osaka/i.test(destLower)) {
    parts.push(`In Japan, the food is the trip. The ramen counter with six stools and no sign is better than most restaurants you've been to.`);
  } else if (/mexico|oaxaca|cdmx/i.test(destLower)) {
    parts.push(`The food here isn't a restaurant experience — it's a street experience. The best things you'll eat will come from someone who's been making the same thing for thirty years.`);
  } else {
    parts.push(`Here's my approach to food on this trip: every meal should feel like it belongs where you already are that day.`);
    parts.push(`No detours across town for a trending restaurant. The food follows the route.`);
  }
  if (kids.hasKids) {
    const ages = kids.ages.map(Number).filter(n => !isNaN(n));
    const youngest = ages.length > 0 ? Math.min(...ages) : null;
    if (youngest && youngest <= 5) parts.push(`Every food stop has something a ${youngest}-year-old will point at and say yes — no negotiations required.`);
    else if (youngest && youngest <= 10) parts.push(`I'm picking places where kids can actually eat, not places where they sit quietly and stare at a prix fixe menu.`);
    else parts.push(`Your kids are old enough to eat the real food here — and I'm going to make sure they get the chance.`);
  } else if (gt === "couple") {
    parts.push(`I'll mix in a couple of dinner spots worth getting dressed for — but some of the best meals will be the ones you didn't plan.`);
  }
  if (hasFood) parts.push(`You flagged food as an interest — so I'm going deeper than the usual recommendations. Expect places with a story.`);
  return parts.join(" ");
}

function buildGemsHype(trip: Trip): string {
  const dest = trip.destination || trip.name;
  const groupRef = buildGroupRef(trip);
  const kids = extractKidsInfo(trip.group_detail || "");
  const gt = (trip.group_type || "").toLowerCase();
  const parts: string[] = [];
  parts.push(`This is the part I'm most excited about.`);
  parts.push(`Anyone can search "top 10 things to do in ${dest}." I'm going to show ${groupRef} the stops most people walk right past.`);
  if (kids.hasKids && kids.ages.length > 0) parts.push(`The kind of places where your kids will remember the weird little detail — the fountain, the cat, the gelato window — twenty years from now.`);
  else if (gt === "couple") parts.push(`A side street with no one else on it. A viewpoint the tour buses can't reach. The kind of moments you'll reference for years.`);
  else if (gt === "friends") parts.push(`The spots that become inside jokes and group chat names. That's what I'm looking for.`);
  else parts.push(`Timing tricks, neighborhood knowledge, the local rhythm — the things that turn a trip into a story worth telling.`);
  parts.push(`That's the kind of trip I build.`);
  return parts.join(" ");
}

// ─────────────────────────────────────────────────────────────────────────────
// BACKGROUND IMAGE CROSSFADE
// ─────────────────────────────────────────────────────────────────────────────

function SlideBackground({ images, fallbackGradient, active }: { images?: string[]; fallbackGradient: string; active: boolean }) {
  const [imgIdx, setImgIdx] = useState(0);
  useEffect(() => {
    if (!active || !images || images.length < 2) return;
    const timer = setInterval(() => setImgIdx(prev => (prev + 1) % images.length), 3000);
    return () => clearInterval(timer);
  }, [active, images]);
  useEffect(() => { if (active) setImgIdx(0); }, [active]);
  if (!images || images.length === 0) {
    return <div style={{ position: "absolute", inset: 0, background: fallbackGradient }} />;
  }
  return (
    <div style={{ position: "absolute", inset: 0 }}>
      {images.map((url, i) => (
        <div key={url} style={{
          position: "absolute", inset: 0,
          backgroundImage: `url(${url})`,
          backgroundSize: "cover", backgroundPosition: "center",
          opacity: i === imgIdx ? 1 : 0,
          transition: "opacity 1.5s ease",
        }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SLIDE BUILDER
// ─────────────────────────────────────────────────────────────────────────────

function buildSlides(
  trip: Trip, days: Day[], stops: Stop[], dayColors: string[], generationComplete: boolean
): Slide[] {
  const slides: Slide[] = [];
  let gradientIdx = 0;
  let cardIdx = 0;
  const tripImages: string[] = Array.isArray((trip as any).slide_images) ? (trip as any).slide_images : [];

  // ── Hype slides ──
  slides.push({
    layout: "center", key: "hype-destination",
    bg: "linear-gradient(160deg, #1a3a4a 0%, #0a2a3a 50%, #2a4a5a 100%)",
    label: "THE DESTINATION", labelColor: "#5DCAA5",
    headline: trip.destination || trip.name,
    body: buildDestinationHype(trip),
    images: tripImages.length >= 2 ? tripImages.slice(0, 2) : undefined,
  });
  gradientIdx++;
  slides.push({
    layout: "center", key: "hype-food",
    bg: "linear-gradient(135deg, #3a1a0a 0%, #6a3a1a 50%, #4a2a10 100%)",
    label: "THE FOOD", labelColor: "#D85A30",
    headline: "How I'm thinking about food.",
    body: buildFoodHype(trip),
    images: tripImages.length >= 4 ? tripImages.slice(2, 4) : tripImages.length >= 2 ? tripImages.slice(0, 2) : undefined,
  });
  gradientIdx++;
  slides.push({
    layout: "center", key: "hype-gems",
    bg: "linear-gradient(160deg, #2a1a3a 0%, #3a2a4a 50%, #1a1a2a 100%)",
    label: "HIDDEN GEMS", labelColor: "#AFA9EC",
    headline: "Things most people miss.",
    body: buildGemsHype(trip),
    images: tripImages.length >= 6 ? tripImages.slice(4, 6) : tripImages.length >= 2 ? tripImages.slice(0, 2) : undefined,
  });
  gradientIdx++;

  // ── City & day slides ──
  const cities = getDistinctCities(days);
  const multiCity = cities.length >= 2;
  const anchoredStops = stops.filter(s => s.is_anchor && s.stop_type !== "transit");
  const bestAnchor = [...anchoredStops].sort((a, b) => (b.ai_note || "").length - (a.ai_note || "").length)[0];

  for (let ci = 0; ci < cities.length; ci++) {
    const city = cities[ci];
    const nextCityStart = ci + 1 < cities.length ? cities[ci + 1].firstDayIndex : days.length;
    const cityDays = days.slice(city.firstDayIndex, nextCityStart);
    if (multiCity) {
      const arrivalLabel = ci === 0 ? "First stop" : ci === cities.length - 1 ? "Final destination" : "Next up";
      slides.push({
        layout: "center", key: `city-${city.city}`,
        bg: getGradient(gradientIdx++),
        label: arrivalLabel, labelColor: "#D85A30",
        headline: city.city,
        body: cityDays[0]?.narrative || `${cityDays.length} day${cityDays.length > 1 ? "s" : ""} in ${city.city}.`,
        images: tripImages.length >= 2 ? tripImages.slice(0, 2) : undefined,
      });
    }
    if (bestAnchor) {
      const anchorDay = days.find(d => d.id === bestAnchor.day_id);
      const anchorDayIdx = anchorDay ? days.indexOf(anchorDay) : -1;
      if (anchorDayIdx >= city.firstDayIndex && anchorDayIdx < nextCityStart) {
        const dayImages: string[] = anchorDay && Array.isArray((anchorDay as any).slide_images) ? (anchorDay as any).slide_images : [];
        slides.push({
          layout: "card", key: `anchor-${bestAnchor.id}`,
          bg: getGradient(gradientIdx++), position: getCardPosition(cardIdx++),
          cardLabel: "Anchor spotlight", cardLabelColor: "#1D9E75",
          dayTitle: bestAnchor.name, dayColor: dayColors[anchorDayIdx] || "#1D9E75",
          body: [bestAnchor.description, bestAnchor.ai_note].filter(Boolean).join(" "),
          stops: [],
          images: dayImages.length >= 2 ? dayImages.slice(0, 2) : undefined,
        });
      }
    }
    for (const day of cityDays) {
      const dayIdx = days.indexOf(day);
      const dayColor = dayColors[dayIdx] || "#1D9E75";
      const dayStops = stops.filter(s => s.day_id === day.id && s.stop_type !== "transit").sort((a, b) => a.sort_order - b.sort_order);
      if (dayStops.length === 0) continue;
      const displayStops = dayStops.length > 5 ? [...dayStops.filter(s => s.is_anchor), ...dayStops.filter(s => !s.is_anchor)].slice(0, 5) : dayStops;
      const hasTransit = stops.some(s => s.day_id === day.id && s.stop_type === "transit");
      const label = hasTransit ? `Day ${day.day_number} — The gear shift` : `Day ${day.day_number}`;
      const narrative = day.narrative || "";
      const reasoning = (day as Day & { reasoning?: string }).reasoning || "";
      const body = reasoning && narrative ? `${narrative} ${reasoning}` : narrative || reasoning || "";
      const dayImages: string[] = Array.isArray((day as any).slide_images) ? (day as any).slide_images : [];
      slides.push({
        layout: "card", key: `day-${day.id}`,
        bg: getGradient(gradientIdx++), position: getCardPosition(cardIdx++),
        cardLabel: label, cardLabelColor: dayColor,
        dayTitle: day.title || `Day ${day.day_number}`, dayColor, body,
        stops: displayStops.map(s => ({ name: s.name, meta: `${s.stop_type} · ${s.duration_minutes} min`, time: formatTime12(s.start_time), isAnchor: !!s.is_anchor, color: dayColor })),
        images: dayImages.length >= 2 ? dayImages.slice(0, 2) : undefined,
      });
    }
  }

  // ── Final slide ──
  if (generationComplete && slides.length > 0) {
    const lastSlide = slides[slides.length - 1];
    if (lastSlide.layout === "center") {
      lastSlide.buttons = { primary: "Explore my trip" };
    }
    if (lastSlide.layout === "card") {
      slides.push({
        layout: "center", key: "final",
        bg: "linear-gradient(135deg, #1a2a1a 0%, #0a1a0a 50%, #2a1a0a 100%)",
        label: "YOUR TRIP IS READY", labelColor: "#5DCAA5",
        headline: trip.name,
        body: (trip as Trip & { trip_summary?: string }).trip_summary || `That's the shape of it. Ready to make it yours?`,
        buttons: { primary: "Explore my trip" },
        images: tripImages.length >= 2 ? tripImages.slice(0, 2) : undefined,
      });
    }
  }
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
// COMPONENT
// ─────────────────────────────────────────────────────────────────────────────

export default function TripTour({ tripId, trip, onComplete, generationComplete }: TripTourProps) {
  const [days, setDays] = useState<Day[]>([]);
  const [stops, setStops] = useState<Stop[]>([]);
  const [current, setCurrent] = useState(0);
  const [cardVisible, setCardVisible] = useState(false);

  const fetchData = useCallback(async () => {
    const [daysRes, stopsRes] = await Promise.all([
      supabase.from("days").select("*").eq("trip_id", tripId).order("day_number"),
      supabase.from("stops").select("*").eq("trip_id", tripId).is("version_owner", null).order("sort_order"),
    ]);
    if (daysRes.data) setDays(daysRes.data as Day[]);
    if (stopsRes.data) setStops(stopsRes.data as Stop[]);
  }, [tripId]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    if (generationComplete) { fetchData(); return; }
    const interval = setInterval(fetchData, 4000);
    return () => clearInterval(interval);
  }, [generationComplete, fetchData]);

  const [currentTrip, setCurrentTrip] = useState(trip);
  useEffect(() => {
    if (!generationComplete) return;
    supabase.from("trips").select("*").eq("id", tripId).maybeSingle()
      .then(({ data }) => { if (data) setCurrentTrip(data as Trip); });
  }, [generationComplete, tripId]);

  const dayColors = generateDayColors(days.length);
  const slides = buildSlides(currentTrip, days, stops, dayColors, generationComplete);

  const slide = slides[current];
  const isFirst = current === 0;
  const isLast = current === slides.length - 1;
  const atEndWaiting = isLast && !generationComplete;

  const goNext = useCallback(() => {
    if (current < slides.length - 1) { setCardVisible(false); setTimeout(() => setCurrent(c => c + 1), 50); }
  }, [current, slides.length]);
  const goPrev = useCallback(() => {
    if (current > 0) { setCardVisible(false); setTimeout(() => setCurrent(c => c - 1), 50); }
  }, [current]);

  useEffect(() => {
    if (slide?.layout === "card") { const t = setTimeout(() => setCardVisible(true), 100); return () => clearTimeout(t); }
    setCardVisible(false);
  }, [current, slide?.layout]);

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
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "#111", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: 40, height: 40, borderRadius: "50%", border: "3px solid #333", borderTopColor: "#1D9E75", animation: "spin 1s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 9999, backgroundColor: "#111", overflow: "hidden" }}>
      {slides.map((s, i) => (
        <div key={s.key} style={{ position: "absolute", inset: 0, opacity: i === current ? 1 : 0, transition: "opacity 0.7s ease", pointerEvents: "none" }}>
          <SlideBackground images={s.images} fallbackGradient={s.bg} active={i === current} />
        </div>
      ))}
      {slides.map((s, i) => s.layout === "center" ? (
        <div key={s.key} style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 40, opacity: i === current ? 1 : 0, transition: "opacity 0.5s ease", pointerEvents: i === current ? "auto" : "none", zIndex: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 500, color: s.labelColor, textTransform: "uppercase", letterSpacing: 1.5, marginBottom: 16 }}>{s.label}</div>
          <div style={{ fontSize: 32, fontWeight: 500, color: "white", lineHeight: 1.2, marginBottom: 20 }}>{s.headline}</div>
          <div style={{ fontSize: 15, color: "rgba(255,255,255,0.6)", lineHeight: 1.7, marginBottom: 36, maxWidth: 460 }}>{s.body}</div>
          {s.buttons && (
            <div style={{ display: "flex", gap: 12 }}>
              <button onClick={onComplete} style={{ padding: "13px 28px", borderRadius: 8, background: "#1D9E75", color: "white", fontSize: 14, fontWeight: 500, border: "none", cursor: "pointer" }}>{s.buttons.primary}</button>
            </div>
          )}
        </div>
      ) : null)}
      {slides.map((s, i) => s.layout === "card" ? (
        <div key={s.key} style={{ position: "absolute", top: s.position.top, left: s.position.left, right: s.position.right, bottom: s.position.bottom, width: 380, background: "rgba(255,255,255,0.96)", borderRadius: 10, backdropFilter: "blur(10px)", zIndex: 10, overflow: "hidden", opacity: i === current && cardVisible ? 1 : 0, transition: "opacity 0.4s ease", pointerEvents: i === current ? "auto" : "none" }}>
          <div style={{ padding: "18px 20px 12px" }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: s.cardLabelColor, textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 4 }}>{s.cardLabel}</div>
            <div style={{ fontSize: 18, fontWeight: 500, color: "#1a1a1a", marginBottom: 10 }}>{s.dayTitle}</div>
            {s.body && (<div style={{ fontSize: 12, color: "#666", lineHeight: 1.6, marginBottom: s.stops.length > 0 ? 12 : 0 }}>{s.body}</div>)}
          </div>
          {s.stops.length > 0 && (
            <div style={{ padding: "0 20px 16px" }}>
              {s.stops.map((st, j) => (
                <div key={j} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0" }}>
                  <div style={{ width: st.isAnchor ? 6 : 3, height: 24, borderRadius: 2, background: st.color, opacity: st.isAnchor ? 1 : 0.25, flexShrink: 0 }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: "#1a1a1a" }}>{st.name}</div>
                    <div style={{ fontSize: 10, color: "#999" }}>{st.meta}</div>
                  </div>
                  {st.time && <div style={{ fontSize: 10, color: "#bbb", whiteSpace: "nowrap", marginRight: 4 }}>{st.time}</div>}
                  {st.isAnchor && <div style={{ flexShrink: 0 }}><AnchorSvg /></div>}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null)}
      {!isFirst && (<button onClick={goPrev} style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.2)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 30, color: "white", fontSize: 18, border: "none" }}>&#8249;</button>)}
      {!isLast && !atEndWaiting && (<button onClick={goNext} style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.2)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 30, color: "white", fontSize: 18, border: "none" }}>&#8250;</button>)}
      {atEndWaiting && (
        <div style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 44, height: 44, borderRadius: "50%", background: "rgba(0,0,0,0.15)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 30 }}>
          <div style={{ width: 16, height: 16, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "rgba(255,255,255,0.5)", animation: "spin 1s linear infinite" }} />
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}
      <div style={{ position: "absolute", bottom: 20, right: 24, fontSize: 11, color: "rgba(255,255,255,0.4)", zIndex: 20, fontWeight: 500 }}>
        {current + 1} / {slides.length}{!generationComplete ? "+" : ""}
      </div>
    </div>
  );
}