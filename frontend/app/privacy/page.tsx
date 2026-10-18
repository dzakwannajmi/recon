import type { Metadata } from "next";
import { Nav } from "@/components/layout/nav";
import { Footer } from "@/components/landing/footer";
import { Container } from "@/components/landing/container";

export const metadata: Metadata = { title: "Privacy | Recon" };

const h = "mt-8 mb-2 text-lg";

/** What signing in stores and how to delete it. Short and plain; keep it in step with supabase/migrations/001_init.sql. */
export default function PrivacyPage() {
  return (
    <>
      <Nav />
      <main className="py-12 md:py-16">
        <Container>
          <article className="mx-auto max-w-[680px] text-sm leading-relaxed">
            <h1 className="text-3xl">Privacy</h1>
            <p className="mt-4">The agent chat and the fact sheets need you to sign in with GitHub, which also lets us save your chats and the evidence you unlock. The on-chain feed contract and the check API for programs stay open.</p>

            <h2 className={h}>What is stored when you sign in</h2>
            <ul className="list-disc pl-5">
              <li>Your sign-in identity (an id and the email, name, GitHub username and profile picture link that GitHub shares; the picture is loaded from GitHub only to show it next to your account menu), kept by our authentication provider, Supabase.</li>
              <li>The chats you save: what you typed, the agent&apos;s answers, and the tool steps behind them.</li>
              <li>Paid evidence bundles you unlock with your own testnet wallet, saved after the payment settles, so you can open them again for free.</li>
            </ul>

            <h2 className={h}>What is not stored</h2>
            <ul className="list-disc pl-5">
              <li>Your payer wallet&apos;s secret key. It stays in this browser only.</li>
              <li>Your IP address or analytics on your saved items.</li>
              <li>Saved evidence is never sent to the AI model.</li>
            </ul>

            <h2 className={h}>Who can read it</h2>
            <p>Each row is readable only by the account that owns it (database row-level security). The site operator can see counts of users and saved chats in the dashboard.</p>

            <h2 className={h}>Delete it</h2>
            <p>Open the account menu and choose &quot;Delete my data&quot; to remove all your saved chats and saved evidence. You can also delete one chat or one saved bundle from the saved list. To remove the sign-in account itself, ask the operator of this site.</p>
          </article>
        </Container>
      </main>
      <Footer />
    </>
  );
}
