import { NextRequest, NextResponse } from "next/server";

const PEXELS_BASE = "https://api.pexels.com/v1/search";

// Second editorial photo source alongside Unsplash. Free tier: 200 req/hr, 20k/mo.
// If PEXELS_API_KEY is not configured, returns an empty image list so callers fall through gracefully.
export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const count = parseInt(req.nextUrl.searchParams.get("count") || "2", 10);
  const exclude = req.nextUrl.searchParams.get("exclude") || ""; // comma-separated URLs to skip

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const apiKey = process.env.PEXELS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ images: [], configured: false });
  }

  const excludeSet = new Set(exclude.split(",").filter(Boolean));

  try {
    // Over-fetch: request 4x what we need so we can skip duplicates and pick quality
    const fetchCount = Math.min(Math.max(count * 4, 8), 80);

    const res = await fetch(
      `${PEXELS_BASE}?${new URLSearchParams({
        query,
        per_page: String(fetchCount),
        orientation: "landscape",
      })}`,
      {
        headers: { Authorization: apiKey },
      },
    );

    if (!res.ok) {
      const msg = await res.text();
      console.error("Pexels API error:", res.status, msg);
      return NextResponse.json({ error: "Pexels API error", status: res.status }, { status: 502 });
    }

    const data = await res.json();

    const candidates = (data.photos || [])
      .map((photo: any) => ({
        url: photo.src?.large2x || photo.src?.large,
        thumb: photo.src?.medium,
        width: photo.width || 0,
        height: photo.height || 0,
        credit: photo.photographer,
        creditUrl: photo.photographer_url,
        description: photo.alt || "",
      }))
      .filter((img: any) => img.url && !excludeSet.has(img.url));

    // Sort: prefer landscape-ish aspect ratio (wider is better for slideshow)
    candidates.sort((a: any, b: any) => {
      const ratioA = a.width && a.height ? a.width / a.height : 1;
      const ratioB = b.width && b.height ? b.width / b.height : 1;
      const scoreA = ratioA >= 1.2 && ratioA <= 2.5 ? 1 : 0;
      const scoreB = ratioB >= 1.2 && ratioB <= 2.5 ? 1 : 0;
      return scoreB - scoreA;
    });

    const images = candidates.slice(0, count);

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Pexels fetch failed:", err);
    return NextResponse.json({ error: "Pexels fetch failed" }, { status: 502 });
  }
}
