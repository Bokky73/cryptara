import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { withCacheHeaders } from "@/server/cache/strategy";
import { checkRateLimitProfile } from "@/server/security/rateLimit";
import { resolveWalletSession } from "@/server/security/walletSession";
import {
  chainFamilySchema,
  networkSchema,
  validateChainScopedWallet,
} from "@/server/security/inputValidation";
import { getNotificationPreferences, upsertNotificationPreferences } from "@/server/storage";
import { defaultNotificationPreferences, ALERT_CHANNELS } from "@/server/observability/alerts/preferences/model";
import type { NotificationPreferences } from "@/server/types";

const channelNameSchema = z.enum(["in_app", "email", "telegram", "discord"]);
const severitySchema = z.enum(["low", "medium", "high", "critical"]);
const categorySchema = z.enum([
  "critical_risk",
  "liquidity",
  "ownership",
  "security",
  "market",
  "portfolio",
  "stellar",
  "infrastructure",
]);
const digestCadenceSchema = z.enum(["off", "hourly", "daily", "weekly"]);

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;

const channelPrefSchema = z.object({
  enabled: z.boolean().default(true),
  minimumSeverity: severitySchema.default("low"),
  categories: z.record(categorySchema, z.boolean()).optional(),
});

const quietHoursSchema = z.object({
  enabled: z.boolean().default(false),
  start: z.string().regex(hhmm, "expected HH:MM").default("22:00"),
  end: z.string().regex(hhmm, "expected HH:MM").default("07:00"),
  timeZone: z.string().min(1).max(64).default("UTC"),
});

const preferencesPatchSchema = z.object({
  walletAddress: z.string().min(1),
  chainFamily: chainFamilySchema.optional(),
  network: networkSchema.optional(),
  channels: z.record(channelNameSchema, channelPrefSchema).optional(),
  quietHours: quietHoursSchema.optional(),
  digestCadence: digestCadenceSchema.optional(),
  dedupeWindowMinutes: z.number().min(0).max(1440).optional(),
});

function resolveScope(wallet: string, chainFamily?: string, network?: string) {
  const family = chainFamily === "stellar" ? "stellar" : "evm";
  const net = network && network.trim() ? network.trim() : family === "stellar" ? "stellar-testnet" : "legacy-evm";
  return { chainFamily: family as "evm" | "stellar", network: net, walletAddress: wallet };
}

export async function GET(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRead");
  if (rateLimited) return rateLimited;

  const url = new URL(request.url);
  const session = resolveWalletSession(request, {
    suppliedWallet: url.searchParams.get("walletAddress"),
  });
  if (session.response) return session.response;
  const wallet = session.wallet!;

  const scope = resolveScope(wallet, url.searchParams.get("chainFamily") ?? undefined, url.searchParams.get("network") ?? undefined);
  const existing = await getNotificationPreferences(scope);

  const preferences: NotificationPreferences =
    existing ?? defaultNotificationPreferences({ walletAddress: wallet, chainFamily: scope.chainFamily, network: scope.network });

  return withCacheHeaders(NextResponse.json(preferences), "alerts");
}

export async function PUT(request: NextRequest) {
  const rateLimited = checkRateLimitProfile(request, "alertRuleWrite");
  if (rateLimited) return rateLimited;

  const body = await request.json().catch(() => ({}));
  const parsed = preferencesPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  if (!validateChainScopedWallet({
    walletAddress: parsed.data.walletAddress,
    chainFamily: parsed.data.chainFamily,
    network: parsed.data.network,
  })) {
    return NextResponse.json({ error: "wallet does not match the requested chain scope" }, { status: 400 });
  }

  const session = resolveWalletSession(request, { suppliedWallet: parsed.data.walletAddress });
  if (session.response) return session.response;
  const wallet = session.wallet!;

  const scope = resolveScope(wallet, parsed.data.chainFamily, parsed.data.network);
  const base = await getNotificationPreferences(scope);
  const defaults = defaultNotificationPreferences({
    walletAddress: wallet,
    chainFamily: scope.chainFamily,
    network: scope.network,
  });

  const mergedChannels = { ...defaults.channels };
  for (const channel of ALERT_CHANNELS) {
    const patch = parsed.data.channels?.[channel];
    if (!patch) continue;
    mergedChannels[channel] = {
      ...mergedChannels[channel],
      ...patch,
      categories: patch.categories ?? mergedChannels[channel].categories,
    };
  }

  const merged: NotificationPreferences = {
    id: base?.id,
    walletAddress: wallet,
    chainFamily: scope.chainFamily,
    network: scope.network,
    channels: mergedChannels,
    quietHours: {
      ...defaults.quietHours,
      ...(base?.quietHours ?? {}),
      ...parsed.data.quietHours,
    },
    digestCadence: parsed.data.digestCadence ?? base?.digestCadence ?? defaults.digestCadence,
    dedupeWindowMinutes: parsed.data.dedupeWindowMinutes ?? base?.dedupeWindowMinutes ?? defaults.dedupeWindowMinutes,
    updatedAt: new Date().toISOString(),
  };

  const saved = await upsertNotificationPreferences(merged);

  return withCacheHeaders(NextResponse.json(saved), "alerts");
}
