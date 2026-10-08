import Link from "next/link";
import { LANGS, type Lang } from "@/lib/factsheet/copy-types";
import { COPY } from "@/lib/factsheet/copy";

/** Plain links to the same page in the other language (no client JS). `path` starts with "/", e.g. "/assets/BENJI". */
export function LangSwitch({ lang, path }: { lang: Lang; path: string }) {
  return (
    <nav aria-label={COPY[lang].nav.language} className="flex items-center gap-3 text-sm">
      <span className="text-muted-foreground">{COPY[lang].nav.language}</span>
      {LANGS.map((l) =>
        l === lang ? (
          <span key={l} lang={l} aria-current="page" className="font-medium text-foreground">{COPY[l].languageName}</span>
        ) : (
          <Link key={l} href={`/${l}${path}`} lang={l} hrefLang={l} className="text-primary underline-offset-4 hover:underline">{COPY[l].languageName}</Link>
        ),
      )}
    </nav>
  );
}
