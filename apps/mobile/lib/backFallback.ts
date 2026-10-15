/**
 * Where Back goes on a pushed screen that has no history to return to: one
 * opened from a link or a notification, or after the web app reloads. Each
 * screen falls back to the tab or list it belongs to; anything else goes Home.
 */
const HOME = "/(app)/(tabs)/home";

export function backFallback(pathname: string): string {
  const path = pathname
    .replace(/[?#].*$/, "")
    .replace(/\/\([^/]+\)/g, "")
    .replace(/\/+$/, "");
  const [first, second] = path.split("/").filter(Boolean);
  switch (first) {
    case "tasks":
      return "/(app)/(tabs)/tasks";
    case "events":
      return "/(app)/(tabs)/calendar";
    case "files":
    case "docs":
    case "sheets":
      return "/(app)/(tabs)/files";
    case "projects":
      return second ? "/(app)/projects" : "/(app)/settings";
    case "settings":
      if (!second) return HOME;
      return second === "workspace" ? "/(app)/settings/workspaces" : "/(app)/settings";
    default:
      return HOME;
  }
}
