export type PaletteScope = { wallet: string; family: "evm" | "stellar"; network: string };
export type SessionAsset = { scope: PaletteScope; assetKey: string; symbol: string; name?: string; source: "portfolio" | "watchlist" };
export type InsightTag = "EVM" | "Stellar" | "Governance" | "Liquidity" | "Security";
export type Command = { id: string; label: string; description: string; href: string; group: "Pages" | "Session assets" | "Insights" | "Recent" | "Scan"; keywords: string[]; tags?: InsightTag[] };
export const MAX_ASSETS = 200;
export const MAX_RESULTS = 30;
export const MAX_QUERY_LENGTH = 512;
