import { login, logout } from "../lib/auth";

/** Signed-out, failed sign-in, or access-removed screen. */
export function Gate({ message, error, signIn = true }: { message?: string; error?: string; signIn?: boolean }) {
  return (
    <div className="gate">
      <div className="gate-card">
        <img src="/logo.png" alt="Volcano Diving Inc" width={88} height={88} />
        <h1>VDI File Share</h1>
        <p>{message ?? <>Sign in to access the shared files.<br />Access is by invitation only.</>}</p>
        {error && <p className="err">{error}</p>}
        <button className="btn primary lg" onClick={signIn ? () => void login() : logout}>{signIn ? "Sign in" : "Sign out"}</button>
      </div>
    </div>
  );
}
