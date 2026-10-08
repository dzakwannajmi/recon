import Link from "next/link";
import { COPY } from "@/lib/factsheet/copy";
import type { Lang } from "@/lib/factsheet/copy-types";
import type { StatusFile } from "@/lib/factsheet/load";
import { findAsset } from "@/lib/factsheet/view";
import { StatusBadge } from "./badges";
import { assetTypeLabel } from "./fact-sheet";
import { LangSwitch } from "./lang-switch";

/** Index table of every asset in the newest status file. */
export function AssetIndex({ lang, status }: { lang: Lang; status: StatusFile }) {
  const copy = COPY[lang];
  return (
    <main lang={lang} className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8 sm:px-6">
      <div className="flex justify-end text-sm"><LangSwitch lang={lang} path="/assets" /></div>
      <header>
        <h1 className="text-3xl font-semibold">{copy.index.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{copy.index.intro}</p>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted-foreground">
            <tr className="border-b border-border">
              <th className="py-2 pr-4 font-medium">{copy.index.asset}</th>
              <th className="py-2 pr-4 font-medium">{copy.index.issuer}</th>
              <th className="py-2 pr-4 font-medium">{copy.index.type}</th>
              <th className="py-2 pr-4 font-medium">{copy.index.status}</th>
              <th className="py-2 font-medium">{copy.index.flagsRaised}</th>
            </tr>
          </thead>
          <tbody>
            {status.assets.map((a) => (
              <tr key={`${a.asset_code}:${a.issuer}`} className="border-b border-border/50 align-top">
                <td className="py-2 pr-4 font-medium">
                  {findAsset(status, a.asset_code) ? (
                    <Link href={`/${lang}/assets/${encodeURIComponent(a.asset_code)}`} className="text-primary underline-offset-4 hover:underline">{a.asset_code}</Link>
                  ) : (
                    a.asset_code
                  )}
                </td>
                <td className="py-2 pr-4 break-words">{a.issuer_org}</td>
                <td className="py-2 pr-4">{assetTypeLabel(lang, a.asset_type)}</td>
                <td className="py-2 pr-4"><StatusBadge status={a.status} unpublished={copy.status.unpublishedBadge} /></td>
                <td className="py-2">{a.raised.map((f) => copy.flags[f.flag]?.name ?? f.flag).join(", ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
