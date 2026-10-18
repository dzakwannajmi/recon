import type { Metadata } from "next";
import { Nav } from "@/components/layout/nav";
import { Footer } from "@/components/landing/footer";
import { Container } from "@/components/landing/container";
import { LoginCard } from "@/components/auth/login-card";

export const metadata: Metadata = { title: "Sign in | Recon" };

/** Sign in with GitHub. The agent chat needs an account; fact sheets and the feed do not. */
export default function LoginPage() {
  return (
    <>
      <Nav />
      <main className="py-16 md:py-24">
        <Container>
          <h1 className="sr-only">Sign in</h1>
          <LoginCard />
        </Container>
      </main>
      <Footer />
    </>
  );
}
