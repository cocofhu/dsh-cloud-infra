/** Compact component reference embedded in the cloud_visualize tool description. */
export const VIEW_CATALOG = `View = { "title"?: string, "items": Component[] } — components are shown top to bottom. Five kinds:
- stats { items: [{ label, value: scalar | { ref, path, agg?: count|sum }, unit?, format?, tone? }] }  — metric numbers; an array path counts items unless agg is "sum".
- table { data, columns?: [{ key: path, title?, format? }], title? }  — rows; columns are inferred when omitted. Sorting, filtering and paging are built in.
- chart { chart: line|bar|pie, data, x, y?: path|path[], series?, unit?, format?, title? }  — rows are grouped by x; y is summed, omitted y counts rows; "series" splits rows into one line/bar group per value. Rows that carry x/y arrays (monitor DataPoints: x "Timestamps", y "Values") become one line each, named by "series".
- kv { data: object, items?: [{ path, label?, format? }], title? }  — fields of one resource.
- tabs { tabs: [{ label, items: Component[] }] }  — e.g. one tab per region; tabs cannot be nested.
"data" binds a cached cloud_call result — { "ref": "r1", "path": "InstanceSet" } — or is small inline JSON. Paths: a.b, a[0], a[*].b. Bind raw results instead of copying or pre-aggregating them. A multi-region result { "<region>": data } used as rows becomes one row per region { "key": "<region>", ...data } (chart x "key", y "TotalCount").
format: number|percent (0-100)|bytes|datetime|status ("status" colors RUNNING/STOPPED/FAILED…). tone: neutral|info|success|warning|danger.
Example:
{ "title": "CVM", "items": [
  { "kind": "stats", "items": [{ "label": "实例", "value": { "ref": "r1", "path": "InstanceSet" } }, { "label": "vCPU", "value": { "ref": "r1", "path": "InstanceSet[*].CPU", "agg": "sum" }, "unit": "核" }] },
  { "kind": "chart", "chart": "pie", "title": "状态", "data": { "ref": "r1", "path": "InstanceSet" }, "x": "InstanceState" },
  { "kind": "table", "data": { "ref": "r1", "path": "InstanceSet" }, "columns": [{ "key": "InstanceId" }, { "key": "InstanceName" }, { "key": "InstanceState", "format": "status" }, { "key": "Placement.Zone", "title": "可用区" }] } ] }`
