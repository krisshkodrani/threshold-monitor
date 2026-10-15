import { text } from "node:stream/consumers";
import { parseArgs } from "node:util";
import { loadConfig } from "./config";
import { openDatabase } from "./db";
import { createUserStore, userRoleSchema, type UserRole } from "./users";

const USAGE = `Usage: echo <password> | cli user:add <username> --name "<display name>" --roles operator,monitor

Adds a user to the database at DATABASE_PATH. The password comes from stdin,
so it does not appear in the shell history or the process list.`;

const MIN_PASSWORD_LENGTH = 8;

async function main(argv: string[]): Promise<number> {
  const { positionals, values } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: { name: { type: "string" }, roles: { type: "string" } },
  });
  const [command, username] = positionals;
  if (command !== "user:add" || !username || !values.name || !values.roles) {
    console.error(USAGE);
    return 2;
  }

  const roles = values.roles.split(",").map((role) => role.trim());
  if (!roles.every((role) => userRoleSchema.safeParse(role).success)) {
    console.error(`Unknown role. Use: ${userRoleSchema.options.join(", ")}.`);
    return 2;
  }
  const password = (await text(process.stdin)).replace(/\r?\n$/, "");
  if (password.length < MIN_PASSWORD_LENGTH) {
    console.error(
      `The password must have at least ${MIN_PASSWORD_LENGTH} characters.`,
    );
    return 2;
  }

  const config = loadConfig(process.env);
  const db = openDatabase(config.databasePath);
  try {
    const users = createUserStore(db);
    if (users.exists(username)) {
      console.error(`The user "${username}" exists already.`);
      return 1;
    }
    const user = await users.add({
      username,
      displayName: values.name,
      password,
      roles: roles as UserRole[],
    });
    console.log(
      `Added user "${user.username}" (${user.roles.join(", ")}) to ${config.databasePath}.`,
    );
    return 0;
  } finally {
    db.close();
  }
}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
