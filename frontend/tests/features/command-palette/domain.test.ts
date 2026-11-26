import { describe, it, expect } from "vitest";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { routeCommands } from "../../../src/lib/commandPalette/registry";
import { insightCommands, insightSlugFromPath } from "../../../src/lib/commandPalette/insights";
import { detectScanTarget, scanHref } from "../../../src/lib/commandPalette/scanTarget";
import { readPaletteRecents, recordInsightVisit, recordScannedAsset, clearPaletteRecents } from "../../../src/lib/commandPalette/persistedRecents";
import { normalizeSearch } from "../../../src/lib/commandPalette/normalize";
import { rankCommands } from "../../../src/lib/commandPalette/ranking";
import { sessionCommands, scopeKey } from "../../../src/lib/commandPalette/scope";
import { rememberCommand } from "../../../src/lib/commandPalette/recent";
import { isPaletteShortcut } from "../../../src/lib/commandPalette/shortcuts";
import { scope, assets } from "./fixtures";
describe("route and local search contracts", () => {
  it("registers only existing baseline destinations", () => {
    for (const command of routeCommands) {
      expect(existsSync(resolve(process.cwd(), `src/app${command.href}/page.tsx`))).toBe(true);
      expect(command.href).not.toContain("?");
    }
    expect(new Set(routeCommands.map(c => c.id)).size).toBe(routeCommands.length);
  });
  it("normalizes Unicode search without normalizing asset identity", () => {
    expect(normalizeSearch(" CAFÉ  ＵＳＤ ")).toBe("cafe usd");
    const local = sessionCommands(scope, assets);
    expect(rankCommands(local, "cafe")[0].label).toBe("USD");
    expect(local[0].id).not.toBe(local[1].id);
  });
  it("ranks exact/prefix matches before keyword matches with stable ties", () => {
    expect(rankCommands(routeCommands, "scan")[0].id).toBe("route:scan");
    expect(rankCommands(routeCommands, "zzzz")).toEqual([]);
    expect(rankCommands(routeCommands, "", ["route:history"])[0].id).toBe("route:history");
  });
  it("isolates wallet and network, including case-sensitive Stellar wallets", () => {
    expect(sessionCommands(scope, assets)).toHaveLength(2);
    expect(sessionCommands(null, assets)).toEqual([]);
    expect(sessionCommands({ ...scope, wallet: scope.wallet.toLowerCase() }, assets)).toEqual([]);
    expect(scopeKey({wallet:"0xAB",family:"evm",network:"base"})).toBe(scopeKey({wallet:"0xab",family:"evm",network:"base"}));
    expect(sessionCommands({ ...scope, network: "stellar-pubnet" }, assets)).toHaveLength(1);
  });
  it("bounds assets/results and deduplicates by full identity", () => {
    expect(sessionCommands(scope, [...assets, ...assets])).toHaveLength(2);
    const lots = Array.from({length:300},(_,i)=>({...assets[0],assetKey:`asset:${i}`}));
    expect(sessionCommands(scope,lots)).toHaveLength(200);
    expect(rankCommands(sessionCommands(scope,lots),"")).toHaveLength(30);
  });
  it("bounds and deduplicates recent commands without storage", () => {
    let recent: string[] = [];for(let i=0;i<20;i++)recent=rememberCommand(recent, String(i));
    expect(recent).toHaveLength(8);expect(rememberCommand(recent,"17").slice(0,3)).toEqual(["17","19","18"]);
  });
  it("respects text fields, IME and conflicting shortcuts", () => {
    expect(isPaletteShortcut(new KeyboardEvent("keydown", {key:"k",ctrlKey:true}))).toBe(true);
    expect(isPaletteShortcut(new KeyboardEvent("keydown", {key:"k",metaKey:true,isComposing:true}))).toBe(false);
    expect(isPaletteShortcut(new KeyboardEvent("keydown", {key:"k",metaKey:true,altKey:true}))).toBe(false);
    const input=document.createElement("input");let accepted=true;
    input.addEventListener("keydown",e=>{accepted=isPaletteShortcut(e);});input.dispatchEvent(new KeyboardEvent("keydown",{key:"k",ctrlKey:true}));
    expect(accepted).toBe(false);
  });
});

describe("insights index", () => {
  it("indexes exactly the insights routes on disk", () => {
    const pages = readdirSync(resolve(process.cwd(), "src/app/insights"), { withFileTypes: true })
      .filter(e => e.isDirectory() && existsSync(resolve(process.cwd(), "src/app/insights", e.name, "page.tsx"))).map(e => `/insights/${e.name}`).sort();
    expect(insightCommands.map(c => c.href).sort()).toEqual(pages);
    expect(insightSlugFromPath("/insights/nope")).toBeNull();
  });
  it("finds tools by slug, tag and fuzzy text within 50ms", () => {
    for (const command of insightCommands) expect(rankCommands(insightCommands, command.href.slice(10))[0].id).toBe(command.id);
    expect(rankCommands(insightCommands, "proxi inspecter")[0].id).toBe("insight:proxy-inspector");
    expect(rankCommands(insightCommands, "sorob footprnt")[0].id).toBe("insight:soroban-auth-footprint");
    expect(rankCommands(insightCommands, "governance").every(c => c.tags?.includes("Governance"))).toBe(true);
    const all = [...routeCommands, ...insightCommands, ...sessionCommands(scope, Array.from({length:200},(_,i)=>({...assets[0],assetKey:`asset:${i}`})))];
    rankCommands(all, "x");
    const start = performance.now(); for (let i = 0; i < 10; i++) rankCommands(all, "soroban auth footprnt");
    expect((performance.now() - start) / 10).toBeLessThan(50);
  });
});
describe("scan targets", () => {
  const evm = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", issuer = "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN";
  it("detects supported inputs", () => {
    expect(detectScanTarget(` ${evm} `, null)).toMatchObject({ query: evm, chain: "base" });
    expect(detectScanTarget(evm, { wallet: evm, family: "evm", network: "1" })?.chain).toBe("ethereum");
    expect(detectScanTarget(`USDC:${issuer}`, null)).toMatchObject({ query: `USDC:${issuer}`, chain: "stellar-testnet" });
    expect(detectScanTarget(`USDC:${issuer}`, { wallet: issuer, family: "stellar", network: "stellar-pubnet" })?.chain).toBe("stellar-pubnet");
    expect(detectScanTarget(`dexscreener.com/ethereum/${evm}?utm=${"x".repeat(200)}`, null)).toMatchObject({ query: `https://dexscreener.com/ethereum/${evm}`, chain: "ethereum" });
  });
  it("rejects invalid or lookalike inputs", () => {
    for (const bad of ["0x123", `${evm}00`, `USDC:${issuer.slice(0, -1)}A`, `TOOLONGASSETCODE:${issuer}`, `https://dexscreener.com.evil.test/base/${evm}`, "https://dexscreener.com/base", `https://dexscreener.com/unknownchain/${evm}`, "scan"]) expect(detectScanTarget(bad, null)).toBeNull();
    expect(scanHref({ query: "a&b", chain: "base" }, "1")).toBe("/scan?query=a%26b&chain=base&run=1");
  });
  it("persists at most five of each, deduplicated, and survives corrupt storage", () => {
    clearPaletteRecents();
    for (const command of insightCommands.slice(0, 7)) recordInsightVisit(command.href.slice(10));
    for (let i = 0; i < 7; i++) recordScannedAsset({ query: `0x${String(i).padStart(40, "1")}`, chain: "base" });
    recordInsightVisit(insightCommands[4].href.slice(10));
    expect(readPaletteRecents().insights).toHaveLength(5); expect(readPaletteRecents().insights[0]).toBe(insightCommands[4].href.slice(10));
    expect(readPaletteRecents().scans).toHaveLength(5);
    window.localStorage.setItem("cryptara:palette-recents:v1", "{bad"); expect(readPaletteRecents()).toEqual({ insights: [], scans: [] });
    clearPaletteRecents(); expect(window.localStorage.length).toBe(0);
  });
});
