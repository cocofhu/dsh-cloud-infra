/** Node-side test surface of the client, bundled into lib/tests/client-under-test.cjs. */
export { ViewRenderer, registerViewComponent } from './renderer/index.js'
export { chartOption, chartHeight } from './renderer/chart-option.js'
export { formatValue, axisLabel, toDate } from './format.js'
export { CallToolView, VisualizeToolView } from './toolviews.js'
export { SettingsCard } from './settings.js'
export { apply, inject } from './index.js'
