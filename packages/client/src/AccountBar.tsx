/** Who is signed in, and the way out. */
export function AccountBar({
  displayName,
  onLogout,
}: {
  displayName: string;
  onLogout: () => void;
}) {
  return (
    <div className="account">
      <span className="muted">
        Signed in as <strong>{displayName}</strong>
      </span>
      <button type="button" className="button--quiet" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}
