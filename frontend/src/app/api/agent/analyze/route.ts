import { NextResponse } from "next/server";
import { z } from "zod";
import { runCryptaraAgent } from "@/server/agent";
import { getPortfolioSnapshot } from "@/server/portfolio/getPortfolio";
import { withApiHandler } from "@/server/api/withApiHandler";

const bodySchema = z.object({
  walletAddress: z.string().optional(),
});

export const POST = withApiHandler(
  {
    schema: bodySchema,
    maxBodyBytes: 16 * 1024,
  },
  async ({ data }) => {
    const { portfolio } = await getPortfolioSnapshot(data.walletAddress);
    return NextResponse.json(runCryptaraAgent(portfolio));
  },
);