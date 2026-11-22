'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';

import { CommandTrigger } from '@/components/commandPalette/CommandTrigger';

type ChainFamily = 'EVM' | 'Stellar';

type InsightDomain =
  | 'Contract & Bytecode'
  | 'Liquidity & Markets'
  | 'Stellar & Soroban'
  | 'Governance & Authorities'
  | 'Social & News'
  | 'Execution & Safety';

interface InsightModule {
  slug: string;
  title: string;
  description: string;
  domain: InsightDomain;
  chains: ChainFamily[];
  pinned?: boolean;
}

const DOMAINS: InsightDomain[] = [
  'Contract & Bytecode',
  'Liquidity & Markets',
  'Stellar & Soroban',
  'Governance & Authorities',
  'Social & News',
  'Execution & Safety',
];

const MODULES: InsightModule[] = [
  {
    slug: 'proxy-inspector',
    title: 'Proxy Inspector',
    description: 'Detect upgradeable proxy patterns and implementation slots.',
    domain: 'Contract & Bytecode',
    chains: ['EVM'],
    pinned: true,
  },
  {
    slug: 'bytecode-diff',
    title: 'Bytecode Diff',
    description: 'Compare deployed bytecode across versions and chains.',
    domain: 'Contract & Bytecode',
    chains: ['EVM'],
  },
  {
    slug: 'liquidity-depth',
    title: 'Liquidity Depth',
    description: 'Measure pool depth and slippage across venues.',
    domain: 'Liquidity & Markets',
    chains: ['EVM', 'Stellar'],
    pinned: true,
  },
  {
    slug: 'market-structure',
    title: 'Market Structure',
    description: 'Map order flow and venue concentration.',
    domain: 'Liquidity & Markets',
    chains: ['EVM'],
  },
  {
    slug: 'soroban-auth-footprint',
    title: 'Soroban Auth Footprint',
    description: 'Inspect authorization footprints for Soroban invocations.',
    domain: 'Stellar & Soroban',
    chains: ['Stellar'],
    pinned: true,
  },
  {
    slug: 'signing-inspector',
    title: 'Signing Inspector',
    description: 'Review signing requirements and signature envelopes.',
    domain: 'Stellar & Soroban',
    chains: ['Stellar'],
    pinned: true,
  },
  {
    slug: 'allowance-inventory',
    title: 'Allowance Inventory',
    description: 'Enumerate token approvals and delegated spenders.',
    domain: 'Governance & Authorities',
    chains: ['EVM', 'Stellar'],
    pinned: true,
  },
  {
    slug: 'authority-graph',
    title: 'Authority Graph',
    description: 'Trace admin roles and privileged call paths.',
    domain: 'Governance & Authorities',
    chains: ['EVM'],
  },
  {
    slug: 'social-signals',
    title: 'Social Signals',
    description: 'Aggregate social sentiment and community chatter.',
    domain: 'Social & News',
    chains: ['EVM', 'Stellar'],
  },
  {
    slug: 'news-digest',
    title: 'News Digest',
    description: 'Curated protocol and ecosystem news.',
    domain: 'Social & News',
    chains: ['EVM', 'Stellar'],
  },
  {
    slug: 'execution-safety',
    title: 'Execution Safety',
    description: 'Pre-flight checks before submitting transactions.',
    domain: 'Execution & Safety',
    chains: ['EVM', 'Stellar'],
  },
  {
    slug: 'simulation-lab',
    title: 'Simulation Lab',
    description: 'Dry-run transactions against forked state.',
    domain: 'Execution & Safety',
    chains: ['EVM'],
  },
];

function ChainBadge({ chain }: { chain: ChainFamily }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        chain === 'EVM'
          ? 'bg-indigo-500/10 text-indigo-400'
          : 'bg-amber-500/10 text-amber-400'
      }`}
    >
      {chain}
    </span>
  );
}

function ModuleCard({ module }: { module: InsightModule }) {
  return (
    <Link
      href={`/insights/${module.slug}`}
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-medium text-foreground">{module.title}</span>
        <div className="flex shrink-0 gap-1">
          {module.chains.map((chain) => (
            <ChainBadge key={chain} chain={chain} />
          ))}
        </div>
      </div>
      <p className="text-sm text-muted">{module.description}</p>
    </Link>
  );
}

export default function InsightsPage() {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return MODULES;
    return MODULES.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.description.toLowerCase().includes(q) ||
        m.domain.toLowerCase().includes(q),
    );
  }, [query]);

  const pinned = filtered.filter((m) => m.pinned);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Insights Hub</h1>
          <p className="text-sm text-muted">
            Discover research modules across contract, market, and execution domains.
          </p>
        </div>
        <CommandTrigger />
      </header>

      <div className="flex flex-col gap-2">
        <label htmlFor="insights-search" className="sr-only">
          Search insights modules
        </label>
        <input
          id="insights-search"
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search modules, domains, or tools…"
          className="w-full rounded-lg border border-border bg-surface px-4 py-2 text-sm text-foreground placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        />
      </div>

      {pinned.length > 0 && (
        <section aria-labelledby="pinned-heading" className="flex flex-col gap-3">
          <h2 id="pinned-heading" className="text-lg font-semibold text-foreground">
            Pinned favorites
          </h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {pinned.map((module) => (
              <ModuleCard key={module.slug} module={module} />
            ))}
          </div>
        </section>
      )}

      {DOMAINS.map((domain) => {
        const modules = filtered.filter((m) => m.domain === domain);
        if (modules.length === 0) return null;
        const headingId = `domain-${domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
        return (
          <section key={domain} aria-labelledby={headingId} className="flex flex-col gap-3">
            <h2 id={headingId} className="text-lg font-semibold text-foreground">
              {domain}
            </h2>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {modules.map((module) => (
                <ModuleCard key={module.slug} module={module} />
              ))}
            </div>
          </section>
        );
      })}

      {filtered.length === 0 && (
        <p className="text-sm text-muted">No modules match “{query}”.</p>
      )}
    </div>
  );
}
