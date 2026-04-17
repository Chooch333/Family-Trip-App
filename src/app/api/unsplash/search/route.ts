import { NextRequest, NextResponse } from "next/server";

const UNSPLASH_BASE = "https://api.unsplash.com/search/photos";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const count = parseInt(req.nextUrl.searchParams.get("count") || "2", 10);
  const exclude = req.nextUrl.searchParams.get("exclude") || ""; // comma-separated URLs to skip

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json({ error: "UNSPLASH_ACCESS_KEY not configured" }, { status: 500 });
  }

  const excludeSet = new Set(exclude.split(",").filter(Boolean));

  try {
    // Over-fetch: request 4x what we need so we can skip duplicates and pick quality
    const fetchCount = Math.min(Math.max(count * 4, 8), 30);

    const res = await fetch(
      `${UNSPLASH_BASE}?${new URLSearchParams({
        query,
        per_page: String(fetchCount),
        orientation: "landscape",
        content_filter: "high",
        order_by: "relevant",
      })}`,
      {
        headers: {
          Authorization: `Client-ID ${accessKey}`,
          "Accept-Version": "v1",
        },
      },
    );

    if (!res.ok) {
      const msg = await res.text();
      console.error("Unsplash API error:", res.status, msg);
      return NextResponse.json({ error: "Unsplash API error", status: res.status }, { status: 502 });
    }

    const data = await res.json();

    // Filter out excluded URLs, prefer wider aspect ratios for slideshow
    const candidates = (data.results || [])
      .map((photo: any) => ({
        url: photo.urls?.regular || photo.urls?.full,
        thumb: photo.urls?.thumb,
        width: photo.width || 0,
        height: photo.height || 0,
        credit: photo.user?.name,
        creditUrl: photo.user?.links?.html,
        description: photo.description || photo.alt_description || "",
      }))
      .filter((img: any) => img.url && !excludeSet.has(img.url));

    // Sort: prefer landscape-ish aspect ratio (wider is better for slideshow)
    candidates.sort((a: any, b: any) => {
      const ratioA = a.width && a.height ? a.width / a.height : 1;
      const ratioB = b.width && b.height ? b.width / b.height : 1;
      // Ideal ratio ~1.5-1.8 for slideshows; penalize very wide panoramas (>2.5) and near-square (<1.2)
      const scoreA = ratioA >= 1.2 && ratioA <= 2.5 ? 1 : 0;
      const scoreB = ratioB >= 1.2 && ratioB <= 2.5 ? 1 : 0;
      return scoreB - scoreA;
    });

    const images = candidates.slice(0, count);

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Unsplash fetch failed:", err);
    return NextResponse.json({ error: "Unsplash fetch failed" }, { status: 502 });
  }
}
