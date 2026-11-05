import { NextResponse } from "next/server";
import { z } from "zod";
import { runCryptaraAgent } from "@/server/agent";
import { getPortfolioSnapshot } from "@/server/portfolio/getPortfolio";

const bodySchema = z.object({
  walletAddress: z.string().optional(),
});

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { portfolio } = await getPortfolioSnapshot(parsed.data.walletAddress);
  return NextResponse.json(runCryptaraAgent(portfolio));
}
