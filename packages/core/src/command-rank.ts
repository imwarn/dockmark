import type { CommandResult, CommandSource } from "./models";

const SOURCE_WEIGHT: Record<CommandSource, number> = {
  tab: 500,
  workspace: 400,
  session: 350,
  bookmark: 300,
  navigation: 200,
  search: 100,
};

export function rankCommands(results: CommandResult[]): CommandResult[] {
  return [...results].sort((a, b) => {
    const aScore = SOURCE_WEIGHT[a.source] + a.score;
    const bScore = SOURCE_WEIGHT[b.source] + b.score;
    return bScore - aScore || a.title.localeCompare(b.title);
  });
}
