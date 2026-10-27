import shared from '@yaniv120892/dev-config/lint-staged';

const scriptCommands = shared['*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'];

export default { ...shared, 'bin/shipyard': scriptCommands };
