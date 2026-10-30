'use strict';
/* Runnable adapter-shape example, explicitly a simulator, not a deployed integration.
 * Replace methods with your trusted system operations and implement observe() by
 * reading its authoritative effect store. Do not turn execute() return values into
 * invented ledger rows. Declare unsupported capabilities rather than passing them.
 */
const { createAdapter: makeSimulator } = require('../framework/adapters/simulator.cjs');
async function createAdapter() {
  const adapter = makeSimulator({ design: 'atomic' });
  adapter.metadata = {
    ...adapter.metadata,
    id: 'example-custom-simulator',
    label: 'Custom-module shape example using the local simulator',
    kind: 'simulator'
  };
  return adapter;
}
module.exports = { createAdapter };
