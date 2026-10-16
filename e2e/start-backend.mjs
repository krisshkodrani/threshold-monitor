// Starts the relay and the sensor for the e2e test, from their production
// builds, and stops both when Playwright stops this process.
import { spawn } from "node:child_process";

const children = [
  spawn("node", ["../server/dist/index.js"], { stdio: "inherit" }),
  spawn("node", ["../sensor/dist/index.js"], { stdio: "inherit" }),
];

function stop() {
  for (const child of children) child.kill("SIGTERM");
}
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
for (const child of children)
  child.on("exit", (code) => {
    // If one part stops by itself, the test cannot work: stop everything.
    stop();
    process.exit(code ?? 1);
  });
