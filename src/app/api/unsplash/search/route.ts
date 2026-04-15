import { NextRequest, NextResponse } from "next/server";

const UNSPLASH_BASE = "https://api.unsplash.com/search/photos";

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const count = parseInt(req.nextUrl.searchParams.get("count") || "2", 10);

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const accessKey = process.env.UNSPLASH_ACCESS_KEY;
  if (!accessKey) {
    return NextResponse.json({ error: "UNSPLASH_ACCESS_KEY not configured" }, { status: 500 });
  }

  try {
    const res = await fetch(
      `${UNSPLASH_BASE}?${new URLSearchParams({
        query,
        per_page: String(Math.min(count, 10)),
        orientation: "landscape",
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
    const images = (data.results || []).slice(0, count).map((photo: any) => ({
      url: photo.urls?.regular || photo.urls?.full,
      thumb: photo.urls?.thumb,
      credit: photo.user?.name,
      creditUrl: photo.user?.links?.html,
    }));

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Unsplash fetch failed:", err);
    return NextResponse.json({ error: "Unsplash fetch failed" }, { status: 502 });
  }
}
