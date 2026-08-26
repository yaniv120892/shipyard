import { linearProvider } from './linear.js';

const PROVIDERS = { linear: linearProvider };

export function getProvider(config) {
  const name = config.tracker?.provider;
  const provider = PROVIDERS[name];
  if (!provider) throw new Error(`unknown tracker provider: ${name}`);
  return provider;
}
