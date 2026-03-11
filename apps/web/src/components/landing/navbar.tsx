"use client";

import { UserButton, useUser } from "@clerk/nextjs";
import Link from "next/link";
import { Button } from "../ui/button";
import ConnectGithubButton from "../github/connect-github-button";

export function Navbar() {
  const { user } = useUser();
  return (
    <header className="w-full border-b ">
      <div className="flex items-center justify-between py-4 container mx-auto">
        <Link href="/" className="font-semibold">
          PFE
        </Link>

        <nav className="flex items-center gap-3 text-sm">
          <Link href="/repos">Repositories</Link>
          <ConnectGithubButton />
          {user ? (
            <UserButton />
          ) : (
            <>
              <Link href="/sign-in">
                <Button variant="ghost">Sign In</Button>
              </Link>
              <Link href="/sign-up">
                <Button>Sign Up</Button>
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
