import { NextRequest, NextResponse } from "next/server";
import { judgePhotos } from "@/lib/judgePhotos";

// Stage 2 of the photo gate: an AI vision pass (HTTP entry point for the browser).
// Server-side callers should import judgePhotos directly instead of calling this route.
export async function POST(req: NextRequest) {
  try {
    const { images, job } = await req.json();
    const scores = await judgePhotos(Array.isArray(images) ? images : [], job || "");
    return NextResponse.json({ scores });
  } catch (err) {
    console.error("Vision judge route failed:", err);
    return NextResponse.json({ scores: [], error: true }, { status: 200 });
  }
}
