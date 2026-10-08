import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AssetIndex } from "@/components/factsheet/asset-index";
import { COPY } from "@/lib/factsheet/copy";
import { LANGS, type Lang } from "@/lib/factsheet/copy-types";
import { loadStatus } from "@/lib/factsheet/load";

export const dynamicParams = false;

type Params = { lang: string };

const isLang = (s: string): s is Lang => (LANGS as readonly string[]).includes(s);

export function generateStaticParams(): Params[] {
  return LANGS.map((lang) => ({ lang }));
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { lang } = await params;
  if (!isLang(lang)) return {};
  return { title: COPY[lang].meta.indexTitle, description: COPY[lang].meta.indexDescription };
}

export default async function Page({ params }: { params: Promise<Params> }) {
  const { lang } = await params;
  if (!isLang(lang)) notFound();
  return <AssetIndex lang={lang} status={loadStatus().status} />;
}
