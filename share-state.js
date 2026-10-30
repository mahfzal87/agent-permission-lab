/* URL state for the teaching workbench. A link contains synthetic inputs only. */
(function (root) {
  'use strict';
  function parse(search, model) {
    const params = new URLSearchParams(search);
    const config = { ...model.defaults };
    const warnings = [];
    let scenario = params.get('scenario') || 'race';
    let design = params.get('design') || 'atomic';
    if (!model.scenarios.some((item) => item.id === scenario)) {
      warnings.push('Unknown experiment in link; loaded the race example.');
      scenario = 'race';
    }
    if (!Object.prototype.hasOwnProperty.call(model.designs, design)) {
      warnings.push('Unknown design in link; loaded the atomic model.');
      design = 'atomic';
    }
    for (const key of Object.keys(config)) {
      if (!params.has(key)) continue;
      const raw = params.get(key);
      const value = Number(raw);
      if (
        !/^\d+$/.test(raw) ||
        !Number.isSafeInteger(value) ||
        value > 100000 ||
        (key !== 'lag' && value === 0)
      ) {
        warnings.push('Invalid ' + key + ' in link; used its default.');
      } else config[key] = value;
    }
    return { scenario, design, config, warnings };
  }
  function serialise(base, state, model) {
    if (
      !model.scenarios.some((item) => item.id === state.scenario) ||
      !Object.prototype.hasOwnProperty.call(model.designs, state.design)
    )
      throw new Error('Unknown experiment or design');
    const config = model.normalise(state.config);
    const url = new URL(base);
    url.search = '';
    url.searchParams.set('scenario', state.scenario);
    url.searchParams.set('design', state.design);
    for (const key of Object.keys(model.defaults)) url.searchParams.set(key, config[key]);
    url.hash = 'workbench';
    return url.href;
  }
  const api = { parse, serialise };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PermissionLabLinks = api;
})(typeof window === 'undefined' ? {} : window);
