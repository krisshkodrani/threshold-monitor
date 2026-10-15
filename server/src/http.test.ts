import { once } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createHttpServer } from "./http";
import { silentLogger } from "./logger";
import { createTestAuth } from "./testing";

let root: string;
let server: Server;
let base: string;

/** Fixture: <root>/monitor/dist, <root>/control/dist and a file that must never be served. */
beforeAll(async () => {
  root = mkdtempSync(path.join(tmpdir(), "relay-static-"));
  mkdirSync(path.join(root, "monitor", "dist"), { recursive: true });
  mkdirSync(path.join(root, "control", "dist", "assets"), { recursive: true });
  writeFileSync(
    path.join(root, "monitor", "dist", "index.html"),
    "<p>monitor app</p>",
  );
  writeFileSync(
    path.join(root, "control", "dist", "index.html"),
    "<p>control app</p>",
  );
  writeFileSync(
    path.join(root, "control", "dist", "assets", "app.js"),
    "console.log(1)",
  );
  writeFileSync(path.join(root, "secret.txt"), "TOP SECRET");

  server = createHttpServer({
    staticDir: root,
    logger: silentLogger,
    auth: createTestAuth().auth,
  });
  server.listen(0);
  await once(server, "listening");
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.close();
  rmSync(root, { recursive: true, force: true });
});

/** Raw GET that sends the path exactly as written (fetch would normalize "..") */
function rawGet(pathname: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    get(`${base}${pathname}`, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += String(chunk)));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
    }).on("error", reject);
  });
}

describe("http server", () => {
  test("health check", async () => {
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });

  test("serves the monitor at / and the control room at /control/", async () => {
    expect(await (await fetch(`${base}/`)).text()).toBe("<p>monitor app</p>");
    expect(await (await fetch(`${base}/control/`)).text()).toBe(
      "<p>control app</p>",
    );
  });

  test("redirects /control to /control/ so relative asset URLs resolve", async () => {
    const res = await fetch(`${base}/control`, { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/control/");
  });

  test("serves control assets with a content type", async () => {
    const res = await fetch(`${base}/control/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/javascript/);
  });

  test("unknown client routes fall back to the app's index.html", async () => {
    expect(await (await fetch(`${base}/control/some/route`)).text()).toBe(
      "<p>control app</p>",
    );
  });

  test.each([
    "/../secret.txt",
    "/..%2fsecret.txt",
    "/control/..%2f..%2fsecret.txt",
  ])("path traversal %s does not escape the app folder", async (attempt) => {
    expect((await rawGet(attempt)).body).not.toContain("TOP SECRET");
  });
});

test("without built apps it still answers health checks and 404s pages", async () => {
  const empty = mkdtempSync(path.join(tmpdir(), "relay-empty-"));
  const bare = createHttpServer({
    staticDir: empty,
    logger: silentLogger,
    auth: createTestAuth().auth,
  });
  bare.listen(0);
  await once(bare, "listening");
  const url = `http://127.0.0.1:${(bare.address() as AddressInfo).port}`;

  expect((await fetch(`${url}/healthz`)).status).toBe(200);
  expect((await fetch(`${url}/`)).status).toBe(404);
  expect((await fetch(`${url}/control/`)).status).toBe(404);

  bare.close();
  rmSync(empty, { recursive: true, force: true });
});
