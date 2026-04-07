import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ content: "The AI assistant isn't connected yet. The Anthropic API key needs to be added to the app's environment variables." }, { status: 200 });
  }
  try {
    const { messages, systemPrompt, max_tokens } = await request.json();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: max_tokens || 1024,
        system: systemPrompt,
        messages: messages.map((m: any) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error:", response.status, response.statusText, errorBody);
      return NextResponse.json({ content: `[API Error ${response.status} ${response.statusText}] ${errorBody}` }, { status: 200 });
    }
    const data = await response.json();
    const content = data.content?.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n") || "I didn't have a response for that.";
    return NextResponse.json({ content });
  } catch (error) {
    console.error("AI chat error:", error);
    return NextResponse.json({ content: `[Caught Error] ${error instanceof Error ? error.message : String(error)}` }, { status: 200 });
  }
}
