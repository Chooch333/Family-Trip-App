import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const PLACES_BASE = "https://places.googleapis.com/v1/places:searchText";

// Server-side Supabase client for storage uploads
function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

export async function GET(req: NextRequest) {
  const query = req.nextUrl.searchParams.get("query");
  const count = Math.min(parseInt(req.nextUrl.searchParams.get("count") || "2", 10), 10);
  const tripId = req.nextUrl.searchParams.get("tripId") || "unknown";

  if (!query) {
    return NextResponse.json({ error: "Missing query parameter" }, { status: 400 });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "GOOGLE_PLACES_API_KEY not configured" }, { status: 500 });
  }

  try {
    // Step 1: Text Search — find multiple places, take best photo from each
    const searchRes = await fetch(`${PLACES_BASE}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-FieldMask": "places.photos,places.displayName",
      },
      body: JSON.stringify({
        textQuery: query,
        maxResultCount: Math.min(count * 2, 10),
        languageCode: "en",
      }),
    });

    if (!searchRes.ok) {
      const msg = await searchRes.text();
      console.error("Google Places search error:", searchRes.status, msg);
      return NextResponse.json({ error: "Places search failed", status: searchRes.status }, { status: 502 });
    }

    const searchData = await searchRes.json();
    const places = searchData.places || [];
    if (places.length === 0) {
      return NextResponse.json({ images: [] });
    }

    // Step 2: Take the first photo from each place (best quality, most iconic)
    const supabase = getSupabaseAdmin();
    const images: string[] = [];

    for (const place of places) {
      if (images.length >= count) break;
      if (!place.photos || place.photos.length === 0) continue;

      try {
        const photo = place.photos[0]; // First photo = highest ranked
        const photoUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=1920&key=${apiKey}`;
        const photoRes = await fetch(photoUrl);
        if (!photoRes.ok) continue;

        const blob = await photoRes.blob();
        const buffer = Buffer.from(await blob.arrayBuffer());

        const timestamp = Date.now();
        const rand = Math.random().toString(36).slice(2, 8);
        const filePath = `${tripId}/${timestamp}-${rand}.jpg`;

        const { error: uploadError } = await supabase.storage
          .from("slide-photos")
          .upload(filePath, buffer, {
            contentType: "image/jpeg",
            cacheControl: "31536000",
            upsert: false,
          });

        if (uploadError) {
          console.error("Supabase upload error:", uploadError.message);
          continue;
        }

        const { data: urlData } = supabase.storage
          .from("slide-photos")
          .getPublicUrl(filePath);

        if (urlData?.publicUrl) {
          images.push(urlData.publicUrl);
        }
      } catch (err) {
        console.error("Photo fetch/upload failed:", err);
        continue;
      }
    }

    return NextResponse.json({ images });
  } catch (err) {
    console.error("Places photos failed:", err);
    return NextResponse.json({ error: "Places photos failed" }, { status: 502 });
  }
}
