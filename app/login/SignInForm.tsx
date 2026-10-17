"use client";

import { useActionState } from "react";
import { signIn } from "./actions";

export function SignInForm() {
  const [error, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="card grid gap-3 p-5">
      <label htmlFor="passcode" className="text-sm font-medium">
        Passcode
      </label>
      <input
        id="passcode"
        name="passcode"
        type="password"
        autoComplete="current-password"
        required
        className="min-h-11 rounded-xl border border-line bg-paper px-3 py-2.5 focus:border-plum focus:outline-none"
      />
      {error && (
        <p role="alert" className="text-sm text-charged">
          {error}
        </p>
      )}
      <button disabled={pending} className="btn btn-primary">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
