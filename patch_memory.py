import re

with open('frontend/src/server/storage/adapters/memory.ts', 'r') as f:
    content = f.read()

# Add WatchlistEntry to import
content = content.replace('X402PaymentReceipt,\n  StorageHealth,', 'X402PaymentReceipt,\n  StorageHealth,\n  WatchlistEntry,')

memory_vars = """
  __cryptaraWatchlistEntries?: WatchlistEntry[];
"""
content = content.replace('__cryptaraX402PaymentReceipts?: X402PaymentReceipt[];', '__cryptaraX402PaymentReceipts?: X402PaymentReceipt[];' + memory_vars)

methods = """
  async addWatchlistEntriesBulk(entries: WatchlistEntry[]): Promise<{ added: WatchlistEntry[] }> {
    memoryStore.__cryptaraWatchlistEntries ??= [];
    const store = memoryStore.__cryptaraWatchlistEntries;
    const added: WatchlistEntry[] = [];
    for (const entry of entries) {
      const existing = store.find(e => e.walletAddress === entry.walletAddress && e.identityKey === entry.identityKey);
      if (!existing) {
        store.unshift(entry);
        added.push(entry);
      }
    }
    return { added };
  }
"""

content = content.replace('async performHealthProbe(): Promise<HealthProbeResult> {', methods + '\n  async performHealthProbe(): Promise<HealthProbeResult> {')

with open('frontend/src/server/storage/adapters/memory.ts', 'w') as f:
    f.write(content)
