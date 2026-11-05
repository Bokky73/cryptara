import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles, Wallet } from "lucide-react";

export default function Home() {
  return (
    <div className="min-h-screen overflow-hidden bg-[#050505] text-white">
      <header className="mx-auto flex h-20 w-full max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-3">
          <Image
            src="/brand/logo.png"
            alt="Cryptara guardian emblem"
            width={48}
            height={48}
            className="rounded-2xl border border-white/10"
            priority
          />
          <div>
            <div className="text-sm font-semibold tracking-[0.18em] text-[#d9a441]">CRYPTARA</div>
            <div className="text-xs text-white/48">Multi-agent portfolio intelligence</div>
          </div>
        </Link>
        <Link
          href="/dashboard"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/7 px-5 text-sm font-semibold text-white transition hover:border-[#d9a441]/40 hover:bg-white/12"
        >
          Go Dashboard
          <ArrowRight className="h-4 w-4 text-[#d9a441]" />
        </Link>
      </header>

      <main className="mx-auto grid min-h-[calc(100vh-80px)] w-full max-w-7xl items-center gap-10 px-5 pb-12 pt-4 sm:px-8 lg:grid-cols-[1.02fr_.98fr]">
        <section className="max-w-3xl">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#d9a441]/25 bg-[#d9a441]/10 px-4 py-2 text-sm text-[#f2c86d]">
            <Sparkles className="h-4 w-4" />
            GOAT Network AI Guardian MVP
          </div>
          <h1 className="mt-8 max-w-4xl text-6xl font-semibold leading-[1.02] tracking-tight text-white sm:text-7xl">
            Cryptara
          </h1>
          <p className="mt-6 max-w-2xl text-xl leading-8 text-white/58">
            Multi-agent crypto portfolio intelligence. Analyze wallet activity, market signals, social sentiment and on-chain data before approving blockchain actions.
          </p>
          <div className="mt-9 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/dashboard"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#d9a441] px-6 text-sm font-semibold text-black transition hover:bg-[#f2c86d]"
            >
              Open Dashboard
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/agents"
              className="inline-flex h-12 items-center justify-center gap-2 rounded-full border border-white/10 bg-white/7 px-6 text-sm font-medium text-white transition hover:bg-white/12"
            >
              View Agents
            </Link>
          </div>
          <div className="mt-12 grid max-w-2xl gap-3 sm:grid-cols-3">
            {[
              ["Observe", "Wallet and market signals"],
              ["Analyze", "Risk scoring and reasoning"],
              ["Act", "Approval-only transaction plan"],
            ].map(([title, text]) => (
              <div key={title} className="rounded-[24px] border border-white/10 bg-white/6 p-5">
                <div className="text-sm font-semibold text-[#d9a441]">{title}</div>
                <div className="mt-2 text-sm leading-6 text-white/48">{text}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass-panel rounded-[32px] p-5">
          <Image
            src="/brand/logo.png"
            alt="Cryptara guardian app mark"
            width={820}
            height={820}
            className="aspect-square w-full rounded-[24px] object-cover"
            priority
          />
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-3xl bg-white/6 p-5">
              <ShieldCheck className="h-5 w-5 text-[#d9a441]" />
              <div className="mt-4 text-3xl font-semibold">87</div>
              <div className="mt-1 text-sm text-white/44">MEME risk score</div>
            </div>
            <div className="rounded-3xl bg-white/6 p-5">
              <Wallet className="h-5 w-5 text-[#d9a441]" />
              <div className="mt-4 text-3xl font-semibold">30%</div>
              <div className="mt-1 text-sm text-white/44">Suggested reduction</div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
