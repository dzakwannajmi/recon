import Link from "next/link";

/** Logo mark plus the lowercase wordmark. Links to the landing page. */
export function Logo() {
  return (
    <Link href="/" className="flex items-center gap-2 rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground">
      <img src="/logo-mark.svg" alt="" width={28} height={28} className="size-7" />
      <span className="text-xl tracking-tight">recon</span>
    </Link>
  );
}
