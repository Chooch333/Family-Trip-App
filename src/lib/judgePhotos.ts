// Shared AI vision scoring — Stage 2 of the photo gate.
// Used directly by both the /api/photos/judge route and server-side callers (e.g. the seed route),
// so server-to-server work never makes an HTTP hop that the deployment's auth wall would block.
// Given candidate image URLs and a job description, Claude scores each 0-100 for fit.

export async function judgePhotos(images: string[], job: string): Promise<number[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const urls = (images || []).filter((u) => typeof u === "string" && u);
  if (!apiKey || urls.length === 0 || !job) return [];

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

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 256, messages: [{ role: "user", content }] }),
    });
    if (!response.ok) {
      console.error("judgePhotos API error:", response.status, await response.text());
      return [];
    }
    const data = await response.json();
    const blocks: Array<{ type: string; text?: string }> = Array.isArray(data.content) ? data.content : [];
    const text = blocks.filter((b) => b.type === "text").map((b) => b.text || "").join("").trim();

    let scores: number[] = [];
    const match = text.match(/\[[\s\S]*?\]/);
    if (match) {
      scores = JSON.parse(match[0]).map((n: unknown) => {
        const v = Math.round(Number(n));
        return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
      });
    }
    while (scores.length < urls.length) scores.push(0);
    return scores.slice(0, urls.length);
  } catch (err) {
    console.error("judgePhotos failed:", err);
    return [];
  }
}
