import { projectHref, projectNames, type Project } from "./projectLinks";
import "./theme.css";
const projects = Object.entries(projectNames) as [Project, string][];
export function ProjectNavigation({
  current,
  language = "en",
}: {
  current: Project;
  language?: "en" | "de";
}) {
  const names: Record<Project, string> =
    language === "de"
      ? {
          monitor: "Live-Monitor",
          control: "Leitstand",
          architecture: "Architekturleitfaden",
        }
      : projectNames;
  return (
    <nav
      className="project-navigation"
      aria-label={language === "de" ? "Projektanwendungen" : "Project apps"}
    >
      {projects.map(([id]) =>
        id === current ? (
          <span key={id} aria-current="page">
            {names[id]}
          </span>
        ) : (
          <a
            key={id}
            href={projectHref(id, window.location, import.meta.env.DEV)}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${names[id]} (${language === "de" ? "in neuem Tab öffnen" : "opens in a new tab"})`}
          >
            {names[id]}
            <span className="project-navigation__arrow" aria-hidden="true">
              ↗
            </span>
          </a>
        ),
      )}
    </nav>
  );
}
