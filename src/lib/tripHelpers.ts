// Shared helper functions used across trip components

export function generateDayColors(count: number): string[] {
  if (count <= 0) return [];
  if (count === 1) return ["hsl(145, 55%, 33%)"];
  const hueStops = [145, 165, 180, 195, 220, 250, 280, 310];
  const satStops = [55, 60, 55, 50, 55, 50, 50, 45];
  const litStops = [33, 38, 40, 42, 42, 40, 38, 38];
  const colors: string[] = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const idx = t * (hueStops.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, hueStops.length - 1);
    const frac = idx - lo;
    const h = hueStops[lo] + (hueStops[hi] - hueStops[lo]) * frac;
    const s = satStops[lo] + (satStops[hi] - satStops[lo]) * frac;
    const l = litStops[lo] + (litStops[hi] - litStops[lo]) * frac;
    colors.push(`hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`);
  }
  return colors;
}

export function getStopBadge(stop: { name: string; description?: string | null; tags?: string[] | null }): { label: string; bg: string; text: string } | null {
  const name = stop.name.toLowerCase();
  const desc = (stop.description || "").toLowerCase();
  const tags = Array.isArray(stop.tags) ? stop.tags.map((t: string) => t.toLowerCase()) : [];
  const all = `${name} ${desc} ${tags.join(" ")}`;

  if (all.match(/\b(breakfast|lunch|dinner|restaurant|cafe|coffee|eat|food|bistro|pizz|taco|bakery|brunch|gelato|ice cream)\b/))
    return { label: "Food", bg: "bg-orange-100", text: "text-orange-700" };
  if (all.match(/\b(walk|hike|trail|stroll|park|garden|beach|nature|waterfall)\b/))
    return { label: "Walking", bg: "bg-green-100", text: "text-green-700" };
  if (all.match(/\b(museum|gallery|castle|monument|cathedral|church|temple|ruins|historic|tour)\b/))
    return { label: "Visit", bg: "bg-blue-100", text: "text-blue-700" };
  if (all.match(/\b(shop|market|store|souvenir|mall|boutique)\b/))
    return { label: "Shopping", bg: "bg-pink-100", text: "text-pink-700" };
  return null;
}

export function formatTime12(time: string | null): string {
  if (!time) return "TBD";
  const parts = time.slice(0, 5).split(":");
  let h = parseInt(parts[0], 10);
  const m = parts[1] || "00";
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}
