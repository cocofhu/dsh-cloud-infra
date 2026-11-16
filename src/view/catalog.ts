/** Compact component reference embedded in the cloud_visualize tool description. */
export const VIEW_CATALOG = `View = { "title"?: string, "body": Node }. Every node has "kind". Data ("data") is a binding to a cached cloud_call result — { "ref": "r1", "path": "InstanceSet" } — or small inline JSON. Paths: a.b, a[0], a[*].b.
Bind raw results instead of copying or pre-aggregating them (no bash/python for counting): charts group and count rows themselves, stats aggregate with "agg". An object of objects — e.g. a multi-region result { "<region>": data } — used where rows are expected becomes one row per entry { "key": "<region>", ...data }: chart x "key", y "TotalCount" compares regions in one call; bind "ap-guangzhou.InstanceSet" for one region's list.
Layout:
- group { children: Node[], direction?: "row"|"column", columns?: 1-6 }
- tabs { tabs: [{ label, body: Node }] }
- card { title?, subtitle?, body: Node }
Data:
- table { data: array, columns?: [{ key: path, title?, format? }], pageSize? }  (columns inferred when omitted)
- kv { data: object, items?: [{ path, label?, format? }], columns?: 1-4 }
- stats { items: [{ label, value: scalar | { ref, path, agg?: count|sum|avg|min|max|first }, unit?, format?, tone? }] }  (an array path with no agg counts items)
- chart { chart: line|area|bar|hbar|pie|donut|scatter|heatmap|gauge, data, x?, y?: path|path[], series?, value?, agg?, stack?, unit?, format?, xFormat? }
    rows: x/y relative to each row; omit y to count rows per x; "series" splits rows into one line/bar group per value.
    each row has x/y arrays (e.g. monitor DataPoints with Timestamps/Values): one series per row, named by "series".
    data is an object of parallel arrays: x and y point to arrays in it.
    pie/donut: x = slice name, y = value (summed) or omitted (count). heatmap: x, y = category paths, value? (count when omitted). gauge: y → one number, max?.
- echarts { option: ECharts option JSON, data?: { "<datasetId>": data } }  (bindings become dataset entries; for charts the simple form cannot express)
- timeline { data: array, time: path, label: path, description?: path, tone?: path }
- tree { data: array, label: path, children?: path (default "children"), value?: path }
Text: markdown { text }, alert { text, tone?, title? }, json { data }
format: text|number|percent (value already 0-100)|bytes|currency|datetime|duration|status|tag|code|link. tone: neutral|info|success|warning|danger. "status" colors common state words (RUNNING, STOPPED, FAILED…).
Example — instances by state and type from ref r1:
{ "title": "CVM", "body": { "kind": "group", "children": [
  { "kind": "stats", "items": [{ "label": "实例", "value": { "ref": "r1", "path": "InstanceSet" } }, { "label": "vCPU", "value": { "ref": "r1", "path": "InstanceSet[*].CPU", "agg": "sum" } }] },
  { "kind": "group", "direction": "row", "children": [
    { "kind": "chart", "chart": "donut", "title": "状态", "data": { "ref": "r1", "path": "InstanceSet" }, "x": "InstanceState" },
    { "kind": "chart", "chart": "hbar", "title": "机型", "data": { "ref": "r1", "path": "InstanceSet" }, "x": "InstanceType", "series": "InstanceState", "stack": true } ] },
  { "kind": "table", "data": { "ref": "r1", "path": "InstanceSet" }, "columns": [{ "key": "InstanceId" }, { "key": "InstanceName" }, { "key": "InstanceState", "format": "status" }, { "key": "Placement.Zone", "title": "可用区" }] } ] } }`
