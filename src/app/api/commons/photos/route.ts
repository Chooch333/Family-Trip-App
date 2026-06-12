import { NextRequest, NextResponse } from "next/server";

const COMMONS_API = "https://commons.wikimedia.org/w/api.php";

// Wikimedia Commons geosearch: real photos of real places, found by coordinates.
// Free, no API key. CC-licensed — attribution is captured and must be stored with the photo.
export async function GET(req: NextRequest) {
  const lat = req.nextUrl.searchParams.get("lat");
  const lng = req.nextUrl.searchParams.get("lng");
  const radius = Math.min(Math.max(parseInt(req.nextUrl.searchParams.get("radius") || "1000", 10), 10), 10000);
  const count = parseInt(req.nextUrl.searchParams.get("count") || "1", 10);

  if (!lat || !lng) {
    return NextResponse.json({ error: "Missing lat/lng parameters" }, { status: 400 });
  }

  try {
    const params = new URLSearchParams({
      action: "query",
      format: "json",
      generator: "geosearch",
      ggsprimary: "all",
      ggsnamespace: "6", // File namespace — images only
      ggsradius: String(radius),
      ggscoord: `${lat}|${lng}`,
      ggslimit: "30",
      prop: "imageinfo",
      iiprop: "url|size|extmetadata",
      iiurlwidth: "1600",
      origin: "*",
    });

    const res = await fetch(`${COMMONS_API}?${params.toString()}`, {
      headers: { "User-Agent": "FamilyTripApp/1.0 (photo sourcing; contact via app)" },
    });

    if (!res.ok) {
      const msg = await res.text();
      console.error("Commons API error:", res.status, msg);
      return NextResponse.json({ error: "Commons API error", status: res.status }, { status: 502 });
    }

    const data = await res.json();
    const pages = data?.query?.pages ? Object.values(data.query.pages) : [];

    // Results arrive nearest-first. Keep common photo formats at usable sizes; skip SVGs/PDFs/TIFFs.
    const candidates = pages
      .map((page: any) => {
        const info = page.imageinfo?.[0];
        if (!info) return null;
        const title: string = page.title || "";
        if (!/\.(jpe?g|png|webp)$/i.test(title)) return null;
        const width = info.thumbwidth || info.width || 0;
        const height = info.thumbheight || info.height || 0;
        const artist = (info.extmetadata?.Artist?.value || "")
          .replace(/<[^>]*>/g, "")
          .trim();
        return {
          url: info.thumburl || info.url,
          width,
          height,
          attribution: artist ? `${artist} / Wikimedia Commons` : "Wikimedia Commons",
        };
      })
      .filter((img: any) => img && img.url && img.width >= 640 && img.height >= 480);

    return NextResponse.json({ images: candidates.slice(0, count) });
  } catch (err) {
    console.error("Commons fetch failed:", err);
    return NextResponse.json({ error: "Commons fetch failed" }, { status: 502 });
  }
}
