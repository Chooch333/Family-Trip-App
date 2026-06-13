import { NextRequest, NextResponse } from "next/server";

// Stage 2 of the photo gate: an AI vision pass.
// Given candidate image URLs and a job description, Claude looks at each image and scores
// 0-100 for how well it fits the job. Only high scorers should be saved by the caller.
// Runs only on Stage-1 (source-triage) survivors, so the per-image cost stays small.
export async function POST(req: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ scores: [], configured: false }, { status: 200 });
  }

  try {
    const { images, job } = await req.json();
    const urls: string[] = Array.isArray(images) ? images.filter((u) => typeof u === "string" && u) : [];
    if (urls.length === 0 || !job) {
      return NextResponse.json({ scores: [] }, { status: 200 });
    }

    // Build one message: the job, then each candidate image in order.
    const content: Array<Record<string, unknown>> = [
      {
        type: "text",
        text: `You are grading photos for a travel app. The job for each photo:\n\n${job}\n\nI will show you ${urls.length} image(s), numbered in order. Score EACH from 0 to 100 for how well it fits the job. Be strict: a blurry shot, a wrong-subject shot, an indoor shot when an exterior is needed, or a generic stock look when a real specific place is needed should all score low. Reply with ONLY a JSON array of numbers in order, e.g. [82, 14, 67]. No words, no code fences.`,
      },
    ];
    urls.forEach((url, i) => {
      content.push({ type: "text", text: `Image ${i + 1}:` });
      content.push({ type: "image", source: { type: "url", url } });
    });

    const body = {
      model: "claude-sonnet-4-20250514",
      max_tokens: 256,
      messages: [{ role: "user", content }],
    };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("Vision judge API error:", response.status, errText);
      return NextResponse.json({ scores: [], error: true }, { status: 200 });
    }

    const data = await response.json();
    const blocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();

    let scores: number[] = [];
    try {
      const match = text.match(/\[[\s\S]*?\]/);
      if (match) {
        scores = JSON.parse(match[0]).map((n: unknown) => {
          const v = Math.round(Number(n));
          return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
        });
      }
    } catch {
      scores = [];
    }

    // Pad/truncate to match input length so callers can zip by index
    while (scores.length < urls.length) scores.push(0);
    scores = scores.slice(0, urls.length);

    return NextResponse.json({ scores });
  } catch (err) {
    console.error("Vision judge failed:", err);
    return NextResponse.json({ scores: [], error: true }, { status: 200 });
  }
}
