import { SourceBytecodeWorkspace } from "@/components/research/source-bytecode/SourceBytecodeWorkspace";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Verified bytecode",
  description: "Compare published verification metadata with deployed runtime bytecode.",
};

export default function SourceBytecodePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col gap-8 px-4 py-10">
      <header className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-[0.18em]">Cryptara · Insights</p>
        <h1 className="text-3xl font-semibold">Verified bytecode</h1>
        <p className="max-w-3xl text-sm">
          A verification badge can be partial, can ignore immutable arguments, or can disagree with the metadata hash.
          This check compares deployed runtime bytecode with published verification metadata at one pinned block.
        </p>
      </header>
      <SourceBytecodeWorkspace />
    </main>
  );
}
