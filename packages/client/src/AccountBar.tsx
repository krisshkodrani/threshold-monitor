import "./AccountBar.css";

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
      <span className="account__name">
        Signed in as <strong>{displayName}</strong>
      </span>
      <button type="button" className="account__logout" onClick={onLogout}>
        Log out
      </button>
    </div>
  );
}
