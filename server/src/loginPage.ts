/**
 * The one login page for both apps, made by the server. A plain form that
 * works without JavaScript; the page has no script at all, which the CSP
 * header in http.ts enforces.
 */
export function loginPage({
  next,
  error,
}: {
  next: string;
  error?: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in · Threshold Monitor</title>
<style>
  :root { color-scheme: light dark; --bg: #f4f5f7; --panel: #fff; --text: #16181d; --muted: #5b6270; --line: #d9dce3; --accent: #2563d9; --on-accent: #fff; --danger: #b42318; }
  @media (prefers-color-scheme: dark) {
    :root { --bg: #111317; --panel: #1a1d23; --text: #e8eaee; --muted: #a0a6b2; --line: #2e333c; --accent: #7aa7ff; --on-accent: #0b1220; --danger: #ff8a80; }
  }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 16px; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  main { width: 100%; max-width: 360px; background: var(--panel); border: 1px solid var(--line); border-radius: 8px; padding: 24px; }
  h1 { margin: 0 0 4px; font-size: 1.4rem; }
  p { margin: 0 0 16px; color: var(--muted); }
  label { display: block; font-weight: 600; margin: 12px 0 4px; }
  input { width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--bg); color: var(--text); font: inherit; }
  button { width: 100%; margin-top: 20px; padding: 10px; border: 0; border-radius: 6px; background: var(--accent); color: var(--on-accent); font: inherit; font-weight: 600; cursor: pointer; }
  .error { color: var(--danger); font-weight: 600; margin: 12px 0 0; }
</style>
</head>
<body>
<main>
  <h1>Threshold Monitor</h1>
  <p>Sign in to continue.</p>
  <form method="post" action="/api/login">
    <input type="hidden" name="next" value="${escapeHtml(next)}">
    <label for="username">Username</label>
    <input id="username" name="username" autocomplete="username" required autofocus>
    <label for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password" required>
    ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ""}
    <button type="submit">Sign in</button>
  </form>
</main>
</body>
</html>
`;
}

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
