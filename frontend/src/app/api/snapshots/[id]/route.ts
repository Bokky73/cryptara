import { NextResponse } from "next/server";
import { readRiskSnapshot } from "@/server/snapshots/store";

const SNAPSHOT_ID = /^snapshot_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function failureStatus(code: string): number {
  if (code === "not_found") return 404;
  if (code === "expired" || code === "revoked") return 410;
  if (code === "unknown_version") return 422;
  return 409;
}

function secureHeaders(response: Response) {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  response.headers.set("X-Content-Type-Options", "nosniff");
  return response;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!SNAPSHOT_ID.test(id)) {
    return secureHeaders(NextResponse.json({ error: "Invalid snapshot id." }, { status: 400 }));
  }

  const result = await readRiskSnapshot(id);
  if (!result.ok) {
    return secureHeaders(NextResponse.json({ error: result.detail, code: result.code }, { status: failureStatus(result.code) }));
  }

  const download = new URL(request.url).searchParams.get("download") === "1";
  if (download) {
    return secureHeaders(new Response(`${JSON.stringify(result.snapshot, null, 2)}\n`, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="cryptara-${id}.json"`,
      },
    }));
  }
  return secureHeaders(NextResponse.json({ snapshot: result.snapshot }));
}
