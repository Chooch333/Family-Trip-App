import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q");
  if (!q) return NextResponse.json({ error: "Missing q parameter" }, { status: 400 });

  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?${new URLSearchParams({
        q,
        format: "json",
        limit: "1",
      })}`,
      { headers: { "User-Agent": "FamilyTripApp/1.0" } },
    );
    const data = await res.json();
    if (data.length > 0) {
      return NextResponse.json({ latitude: parseFloat(data[0].lat), longitude: parseFloat(data[0].lon) });
    }
    return NextResponse.json({ latitude: null, longitude: null });
  } catch {
    return NextResponse.json({ error: "Geocoding failed" }, { status: 502 });
  }
}
