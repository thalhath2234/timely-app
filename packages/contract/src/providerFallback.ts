/** The parts of the agent provider overview that decide where chat goes. */
export type ProviderSetup = {
  defaultProvider: string;
  localCli: boolean;
  openrouter: { keySet: boolean };
  claude: { connected: boolean };
  codex: { connected: boolean };
  apiProviders?: { id: string; connected: boolean }[];
};

/** The provider chat and the writing tools move to once `removed` is
 * disconnected, or "" when nothing else is set up. It follows the server's
 * pick for an account with no chosen default (provider/handler.go
 * autoProvider): direct API keys in catalog order, then a connected CLI, and
 * OpenRouter last. A provider that is not the default changes nothing, so it
 * returns the default. */
export function providerAfterRemoval(setup: ProviderSetup, removed: string): string {
  if (setup.defaultProvider !== removed) return setup.defaultProvider;
  const order = [
    ...(setup.apiProviders ?? []).filter((api) => api.connected).map((api) => api.id),
    ...(setup.localCli && setup.claude.connected ? ["claude"] : []),
    ...(setup.localCli && setup.codex.connected ? ["codex"] : []),
    ...(setup.openrouter.keySet ? ["openrouter"] : []),
  ];
  return order.find((id) => id !== removed) ?? "";
}
