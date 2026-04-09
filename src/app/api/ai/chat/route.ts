import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ content: [{ type: "text", text: "The AI assistant isn't connected yet. The Anthropic API key needs to be added to the app's environment variables." }] }, { status: 200 });
  }
  try {
    const { messages, systemPrompt, max_tokens, tools } = await request.json();
    const body: Record<string, unknown> = {
      model: "claude-sonnet-4-20250514",
      max_tokens: max_tokens || 1024,
      system: systemPrompt,
      messages: messages.map((m: { role: string; content: string }) => ({ role: m.role, content: m.content })),
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
    }
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errorBody = await response.text();
      console.error("Anthropic API error:", response.status, response.statusText, errorBody);
      if (response.status === 529) {
        return NextResponse.json({ content: [{ type: "text", text: "Claude is busy right now — try again in a moment." }] }, { status: 200 });
      }
      return NextResponse.json({ content: [{ type: "text", text: `Something went wrong (error ${response.status}). Please try again.` }] }, { status: 200 });
    }
    const data = await response.json();
    return NextResponse.json({ content: data.content || [] });
  } catch (error) {
    console.error("AI chat error:", error);
    return NextResponse.json({ content: [{ type: "text", text: `Something went wrong. Please try again.` }] }, { status: 200 });
  }
}
