import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FactSheet } from "@/components/factsheet/fact-sheet";
import { COPY } from "@/lib/factsheet/copy";
import { LANGS, type Lang } from "@/lib/factsheet/copy-types";
import { loadStatus } from "@/lib/factsheet/load";
import { findAsset, fmt } from "@/lib/factsheet/view";

// Every page is generated at build time from the newest data/status file; anything else is a 404.
export const dynamicParams = false;

type Params = { lang: string; code: string };

const isLang = (s: string): s is Lang => (LANGS as readonly string[]).includes(s);

export function generateStaticParams(): Params[] {
  const { status } = loadStatus();
  const codes = status.assets.map((a) => a.asset_code).filter((c, i, all) => all.indexOf(c) === i && findAsset(status, c));
  return LANGS.flatMap((lang) => codes.map((code) => ({ lang, code })));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { lang, code } = await params;
  const asset = isLang(lang) ? findAsset(loadStatus().status, code) : null;
  if (!isLang(lang) || !asset) return {};
  const vars = { code: asset.asset_code, issuer_org: asset.issuer_org };
  return { title: fmt(COPY[lang].meta.title, vars), description: fmt(COPY[lang].meta.description, vars) };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { lang, code } = await params;
  if (!isLang(lang)) notFound();
  const { status } = loadStatus();
  const asset = findAsset(status, code);
  if (!asset) notFound();
  return <FactSheet lang={lang} asset={asset} status={status} />;
}
