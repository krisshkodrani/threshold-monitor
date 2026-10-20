export type Project = "monitor" | "control" | "architecture";
export const projectName = "Threshold Monitor";
export const projectNames: Record<Project, string> = {
  monitor: "Live Monitor",
  control: "Control Room",
  architecture: "Architecture Guide",
};
const paths: Record<Project, string> = {
  monitor: "/",
  control: "/control/",
  architecture: "/architecture/",
};
const ports: Record<Project, string> = {
  monitor: "5173",
  control: "5174",
  architecture: "5175",
};
/** Development uses separate Vite origins; deployed apps share the relay origin. */
export function projectHref(
  project: Project,
  location: Pick<Location, "href" | "protocol">,
  development: boolean,
): string {
  const offline = location.protocol === "file:";
  const url = new URL(offline ? "http://localhost/" : location.href);
  url.pathname = paths[project];
  url.search = "";
  url.hash = "";
  if (development || offline) {
    url.port = ports[project];
    if (project === "architecture") url.pathname = "/";
  }
  return url.href;
}
