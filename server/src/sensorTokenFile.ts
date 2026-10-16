import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const MIN_LENGTH = 16;

/**
 * The sensor token from a file, so `docker compose up` needs no setup. If the
 * file exists, its token is used, so a restart keeps the same token. If not,
 * a random token is made and written (mode 0600; only this user can read it).
 * The sensor container reads the same file from the shared volume.
 */
export function loadOrCreateSensorToken(file: string): {
  token: string;
  created: boolean;
} {
  const existing = readToken(file);
  if (existing !== undefined) return { token: existing, created: false };

  const token = randomBytes(24).toString("hex");
  mkdirSync(path.dirname(file), { recursive: true });
  try {
    // "wx": fail if the file exists, so two starts at once cannot both write.
    writeFileSync(file, `${token}\n`, { mode: 0o600, flag: "wx" });
    return { token, created: true };
  } catch (err) {
    if (codeOf(err) !== "EEXIST") throw err;
    return { token: readToken(file)!, created: false };
  }
}

function readToken(file: string): string | undefined {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if (codeOf(err) === "ENOENT") return undefined;
    throw err;
  }
  const token = text.trim();
  if (token.length < MIN_LENGTH)
    throw new Error(
      `The sensor token in ${file} is shorter than ${MIN_LENGTH} characters.`,
    );
  return token;
}

const codeOf = (err: unknown) =>
  err && typeof err === "object" && "code" in err ? err.code : undefined;
