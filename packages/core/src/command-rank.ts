import type { CommandResult, CommandSource } from "./models";

export const LAUNCHER_SOURCE_WEIGHT: Record<CommandSource, number> = {
  tab: 500,
  workspace: 400,
  session: 350,
  collection: 325,
  bookmark: 300,
  navigation: 200,
  search: 100,
};

export const LAUNCHER_SOURCE_LABEL: Record<CommandSource, string> = {
  tab: "Open tab",
  workspace: "Workspace",
  session: "Session",
  collection: "Collection",
  bookmark: "Bookmark",
  navigation: "Navigation",
  search: "Search",
};

function normalize(value: string | null | undefined) {
  return String(value ?? "").toLocaleLowerCase();
}

export function launcherTextScore(
  query: string,
  primary: string | null | undefined,
  secondary: Array<string | null | undefined> = [],
  base = 0,
): number {
  const needle = normalize(query).trim();
  if (!needle) return base;

  const primaryText = normalize(primary);
  const secondaryText = secondary.map(normalize).join("\n");
  const terms = needle.split(/\s+/).filter(Boolean);
  if (!terms.every((term) => primaryText.includes(term) || secondaryText.includes(term))) return -1;

  let score = base + Math.min(18, Math.max(0, terms.length - 1) * 3);
  if (primaryText === needle) score += 90;
  else if (primaryText.startsWith(needle)) score += 60;
  else if (primaryText.includes(needle)) score += 35;
  else if (secondaryText.includes(needle)) score += 15;
  else score += 8;
  return score;
}

export function rankCommands(results: CommandResult[]): CommandResult[] {
  return [...results].sort((a, b) => {
    const aScore = LAUNCHER_SOURCE_WEIGHT[a.source] + a.score;
    const bScore = LAUNCHER_SOURCE_WEIGHT[b.source] + b.score;
    return bScore - aScore || a.title.localeCompare(b.title);
  });
}
