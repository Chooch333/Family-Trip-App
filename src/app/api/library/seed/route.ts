import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { judgePhotos } from "@/lib/judgePhotos";

export const maxDuration = 60;

const UNSPLASH_BASE = "https://api.unsplash.com/search/photos";
const HIGH_CONFIDENCE = 70; // only photos scoring >= this are saved

// ── Shelf definitions: key → search queries (top result of each becomes a candidate) ──

const REGION_QUERIES: Record<string, string[]> = {
  "midwest-river": ["mississippi river bend aerial golden hour", "midwest river town waterfront", "river barge midwest sunset"],
  "midwest-farmland": ["midwest farmland golden hour aerial", "corn field sunset rural road", "red barn farmland landscape"],
  "great-lakes": ["great lakes shoreline lighthouse", "lake michigan beach dunes", "great lakes pier sunset"],
  "plains": ["great plains prairie big sky", "wheat field horizon sunset", "plains storm clouds landscape"],
  "mountain-west": ["rocky mountains alpine lake", "mountain valley sunrise mist", "snowcapped peaks wildflower meadow"],
  "desert-southwest": ["desert southwest red rock formations", "saguaro cactus sunset arizona", "southwest canyon golden light"],
  "southeast": ["live oak trees spanish moss", "southern small town main street", "blue ridge mountains overlook"],
  "new-england": ["new england coastal village harbor", "new england fall foliage country road", "lighthouse rocky coast maine"],
  "pacific-northwest": ["pacific northwest forest mist", "oregon coast sea stacks", "evergreen mountains lake reflection"],
  "gulf-coast": ["gulf coast beach sunset", "white sand beach gulf shores", "bayou cypress trees water"],
};

const CATEGORY_QUERIES: Record<string, string[]> = {
  "coffee": ["latte art coffee shop wooden table", "cozy coffee shop interior warm light", "pour over coffee cafe counter"],
  "meal": ["restaurant plated dinner warm light", "family style dinner table restaurant", "rustic restaurant meal spread"],
  "bakery": ["bakery pastry display case", "fresh croissants bakery morning", "artisan bread bakery shelves"],
  "park-trail": ["forest hiking trail dappled sunlight", "park path trees walking", "nature trail boardwalk wetland"],
  "museum": ["museum gallery interior light", "art museum grand hall", "natural history museum exhibit"],
  "water": ["lakeside wooden dock morning calm", "riverfront walkway water", "calm lake reflection trees"],
  "main-street": ["small town main street america", "historic downtown storefronts brick", "main street evening warm lights"],
  "shop": ["boutique shop interior shelves", "local bookstore cozy shelves", "general store storefront"],
  "brewery": ["craft brewery taproom interior", "beer flight wooden board brewery", "brewery steel tanks warm light"],
};

const PRIDE_QUERIES: Record<string, string[]> = {
  // States — welcome signs + flags flying in real scenes (never full-bleed graphic flags)
  "illinois": ["welcome to Illinois sign", "Illinois state flag flying flagpole"],
  "wisconsin": ["welcome to Wisconsin sign", "Wisconsin state flag flying flagpole"],
  "michigan": ["welcome to Michigan sign", "Michigan state flag flying flagpole"],
  "ohio": ["welcome to Ohio sign", "Ohio state flag flying flagpole"],
  "indiana": ["welcome to Indiana sign", "Indiana state flag flying flagpole"],
  "missouri": ["welcome to Missouri sign", "Missouri state flag flying flagpole"],
  "iowa": ["welcome to Iowa sign", "Iowa state flag flying flagpole"],
  "minnesota": ["welcome to Minnesota sign", "Minnesota state flag flying flagpole"],
  "texas": ["welcome to Texas sign", "Texas state flag flying flagpole"],
  "california": ["welcome to California sign", "California state flag flying flagpole"],
  "florida": ["welcome to Florida sign", "Florida state flag flying flagpole"],
  "new-york": ["welcome to New York state sign", "New York state flag flying flagpole"],
  // Nations — same concept carried over
  "usa": ["american flag flying front porch", "welcome to United States border sign"],
  "canada": ["canada flag flying flagpole mountains", "welcome to Canada border sign"],
  "mexico": ["mexico flag flying zocalo", "welcome to Mexico border sign"],
  "france": ["france flag flying building paris", "french tricolor flag flying"],
  "italy": ["italy flag flying building", "italian flag flying piazza"],
  "japan": ["japan flag flying temple", "japanese flag flying building"],
};

const KIND_MAP: Record<string, Record<string, string[]>> = {
  region: REGION_QUERIES,
  category: CATEGORY_QUERIES,
  pride: PRIDE_QUERIES,
};

function jobFor(kind: string, key: string): string {
  const readable = key.replace(/-/g, " ");
  if (kind === "region") {
    return `An evocative, high-quality landscape photo of the US "${readable}" region, good for a full-screen slide background behind white text. Atmospheric, good light and depth — not a close-up, not cluttered, not a portrait.`;
  }
  if (kind === "category") {
    return `A beautiful, high-quality, appealing generic photo representing "${readable}" — a tasteful stand-in you'd be happy to show for a place of this type. Well-composed, warm, inviting. Not a logo, not text-heavy, not low quality.`;
  }
  return `A real-world photo representing "${readable}" pride: either a real "welcome to" road sign, OR an actual flag flying on a pole in a real outdoor scene. It must NOT be a flat full-bleed graphic flag, a vector/clip-art flag, or an illustration.`;
}

// Seeds photo_library with UNAPPROVED candidates for review in the photo widget.
// Idempotent: any key that already has rows is skipped, so re-running is safe.
// Batched by kind to stay inside the Unsplash hourly quota.
export async function GET(req: NextRequest) {
  const kindParam = req.nextUrl.searchParams.get("kind") || "";
  const keysFilter = (req.nextUrl.searchParams.get("keys") || "").split(",").filter(Boolean);

  if (kindParam !== "region" && kindParam !== "category" && kindParam !== "pride") {
    return NextResponse.json({ error: "kind must be one of: region, category, pride" }, { status: 400 });
  }
  const kind = kindParam; // narrowed to "region" | "category" | "pride"
  const queryMap = KIND_MAP[kind];

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json({ error: "UNSPLASH_ACCESS_KEY not configured" }, { status: 500 });
  }

  const seeded: Record<string, number> = {};
  const skipped: string[] = [];
  let rateLimitRemaining = -1;
  let quotaExhausted = false;

  const keys = Object.keys(queryMap).filter(k => keysFilter.length === 0 || keysFilter.includes(k));

  for (const key of keys) {
    if (quotaExhausted) break;

    // Idempotency: skip shelves that already have candidates
    const { count } = await supabase.from("photo_library")
      .select("id", { count: "exact", head: true })
      .eq("kind", kind).eq("key", key);
    if (count && count > 0) { skipped.push(key); continue; }

    // ── Stage 1: gather candidates from Unsplash (orientation/quality filtered at source) ──
    const queries = queryMap[key];
    const gathered: { url: string; attribution: string }[] = [];
    for (const q of queries) {
      if (quotaExhausted) break;
      try {
        const res = await fetch(`${UNSPLASH_BASE}?${new URLSearchParams({
          query: q, per_page: "4", orientation: "landscape", content_filter: "high",
        })}`, { headers: { Authorization: `Client-ID ${accessKey}`, "Accept-Version": "v1" } });
        const remaining = parseInt(res.headers.get("X-Ratelimit-Remaining") || "-1", 10);
        if (remaining >= 0) rateLimitRemaining = remaining;
        if (res.status === 403 || res.status === 429) { quotaExhausted = true; break; }
        if (!res.ok) continue;
        const data = await res.json();
        for (const photo of (data.results || [])) {
          const url = photo.urls?.regular || photo.urls?.full;
          if (url && !gathered.some(g => g.url === url)) {
            gathered.push({ url, attribution: photo.user?.name ? `${photo.user.name} / Unsplash` : "Unsplash" });
          }
        }
      } catch { /* skip this query */ }
    }
    if (gathered.length === 0) continue;

    // ── Stage 2: AI vision pass — keep only high-confidence ──
    let scores: number[] = [];
    try {
      scores = await judgePhotos(gathered.map(g => g.url), jobFor(kind, key));
    } catch { /* no scores → nothing saved for this key */ }

    const rows = gathered
      .map((g, i) => ({ ...g, score: scores[i] ?? 0 }))
      .filter(g => g.score >= HIGH_CONFIDENCE)
      .map(g => ({ kind, key, url: g.url, source: "unsplash", attribution: g.attribution, approved: true, vision_score: g.score }));

    if (rows.length > 0) {
      const { error } = await supabase.from("photo_library").insert(rows);
      if (!error) seeded[key] = rows.length;
    }
  }

  return NextResponse.json({ kind, threshold: HIGH_CONFIDENCE, seeded, skipped, rateLimitRemaining, quotaExhausted });
}
