export const STYLE_ID = 'dsh-cloud-infra-style'

export const CSS = `
.ci-root{font-family:inherit;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5;min-width:0}
.ci-tool{margin:4px 0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.ci-tool-head{display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;user-select:none;min-width:0;background:transparent;border:0;width:100%;font:inherit;color:inherit;text-align:left}
.ci-tool-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ci-tool-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-tool-sub{color:var(--dsw-alias-label-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.ci-tool-body{border-top:1px solid var(--dsw-alias-border-l1);padding:10px 12px}
.ci-chev{width:12px;height:12px;flex:none;color:var(--dsw-alias-label-tertiary);transition:transform .15s}
.ci-chev.open{transform:rotate(90deg)}
.ci-badge{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:11px;line-height:18px;white-space:nowrap;background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-secondary);flex:none}
.ci-badge.success{background:var(--dsw-alias-state-success-tertiary);color:var(--dsw-alias-state-success-primary)}
.ci-badge.warning{background:var(--dsw-alias-state-warn-tertiary);color:var(--dsw-alias-state-warn-label)}
.ci-badge.danger{background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.ci-badge.info{background:var(--dsw-alias-state-business-tertiary);color:var(--dsw-alias-state-business-primary)}
.ci-dot{width:6px;height:6px;border-radius:50%;background:currentColor;flex:none}
.ci-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ci-spin .7s linear infinite;flex:none;color:var(--dsw-alias-label-tertiary)}
@keyframes ci-spin{to{transform:rotate(360deg)}}
.ci-meta{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;color:var(--dsw-alias-label-caption);margin-bottom:8px}
.ci-meta b{color:var(--dsw-alias-label-secondary);font-weight:500;margin-left:4px}
.ci-pre{margin:0;padding:10px;border-radius:8px;background:var(--dsw-alias-bg-layer-3);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.55;white-space:pre-wrap;word-break:break-all;max-height:360px;overflow:auto}
.ci-err{color:var(--dsw-alias-state-error-primary);font-size:12px;white-space:pre-wrap;word-break:break-word}
.ci-view{padding:2px 0}
.ci-view-title{font-size:15px;font-weight:650;margin:2px 0 10px}
.ci-col{display:flex;flex-direction:column;gap:12px;min-width:0}
.ci-row{display:flex;flex-wrap:wrap;gap:12px;min-width:0}
.ci-row>*{flex:1 1 260px;min-width:0}
.ci-grid{display:grid;gap:12px;min-width:0}
.ci-card{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-layer-1);padding:12px;min-width:0}
.ci-card-h{margin-bottom:8px}
.ci-card-t{font-weight:600;font-size:14px}
.ci-card-s{color:var(--dsw-alias-label-tertiary);font-size:12px}
.ci-sec-t{font-weight:600;margin:0 0 6px;font-size:13px}
.ci-tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2);margin-bottom:10px;overflow-x:auto}
.ci-tab{appearance:none;border:0;border-bottom:2px solid transparent;background:transparent;padding:7px 12px;cursor:pointer;color:var(--dsw-alias-label-caption);font:inherit;white-space:nowrap}
.ci-tab.on{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);border-bottom-color:var(--dsw-alias-brand-primary-new-colorprimary-new-color);font-weight:600}
.ci-table-wrap{overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;max-height:520px}
.ci-table{border-collapse:collapse;width:100%;font-size:12px}
.ci-table th{position:sticky;top:0;background:var(--dsw-alias-bg-layer-3);text-align:left;font-weight:600;color:var(--dsw-alias-label-secondary);padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l2);white-space:nowrap;cursor:pointer;user-select:none}
.ci-table td{padding:6px 10px;border-bottom:1px solid var(--dsw-alias-border-l1);vertical-align:top;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ci-table tr:last-child td{border-bottom:0}
.ci-table tbody tr:hover td{background:var(--dsw-alias-interactive-bg-hover)}
.ci-table code,.ci-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;background:var(--dsw-alias-bg-layer-3);padding:1px 5px;border-radius:4px}
.ci-tbar{display:flex;align-items:center;gap:8px;margin-bottom:6px;font-size:12px;color:var(--dsw-alias-label-caption)}
.ci-tbar input{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);border-radius:6px;padding:4px 8px;font:inherit;font-size:12px;min-width:0;width:180px}
.ci-tbar .ci-grow{flex:1}
.ci-pager{display:flex;align-items:center;gap:6px;justify-content:flex-end;margin-top:6px;font-size:12px;color:var(--dsw-alias-label-caption)}
.ci-btn{appearance:none;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-button-elevated-fill);color:var(--dsw-alias-label-primary);border-radius:6px;padding:3px 10px;cursor:pointer;font:inherit;font-size:12px}
.ci-btn:disabled{opacity:.45;cursor:default}
.ci-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.ci-btn.danger{color:var(--dsw-alias-state-error-primary)}
.ci-kv{display:grid;gap:6px 18px}
.ci-kv-i{display:flex;flex-direction:column;min-width:0}
.ci-kv-l{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ci-kv-v{word-break:break-all}
.ci-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.ci-stat{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1)}
.ci-stat-l{font-size:12px;color:var(--dsw-alias-label-caption)}
.ci-stat-v{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;line-height:1.3}
.ci-stat-v small{font-size:12px;font-weight:500;color:var(--dsw-alias-label-tertiary);margin-left:3px}
.ci-stat.success .ci-stat-v{color:var(--dsw-alias-state-success-primary)}
.ci-stat.warning .ci-stat-v{color:var(--dsw-alias-state-warn-label)}
.ci-stat.danger .ci-stat-v{color:var(--dsw-alias-state-error-primary)}
.ci-stat.info .ci-stat-v{color:var(--dsw-alias-state-business-primary)}
.ci-stat-h{font-size:11px;color:var(--dsw-alias-label-tertiary)}
.ci-chart{width:100%;min-height:120px;position:relative}
.ci-chart-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--dsw-alias-label-tertiary);font-size:12px}
.ci-tl{list-style:none;margin:0;padding:0 0 0 14px;border-left:2px solid var(--dsw-alias-border-l2)}
.ci-tl li{position:relative;padding:0 0 10px 10px}
.ci-tl li::before{content:"";position:absolute;left:-20px;top:5px;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);border:2px solid var(--dsw-alias-label-tertiary)}
.ci-tl li.success::before{border-color:var(--dsw-alias-state-success-primary)}
.ci-tl li.warning::before{border-color:var(--dsw-alias-state-warn-label)}
.ci-tl li.danger::before{border-color:var(--dsw-alias-state-error-primary)}
.ci-tl li.info::before{border-color:var(--dsw-alias-state-business-primary)}
.ci-tl-t{font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.ci-tl-d{color:var(--dsw-alias-label-caption);font-size:12px}
.ci-tree{list-style:none;margin:0;padding-left:16px}
.ci-tree.root{padding-left:0}
.ci-tree-n{display:flex;align-items:center;gap:6px;padding:2px 0;cursor:default}
.ci-tree-n button{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;width:16px;padding:0;font:inherit}
.ci-tree-v{color:var(--dsw-alias-label-tertiary);font-size:12px}
.ci-alert{border-radius:8px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.ci-alert.success{background:var(--dsw-alias-state-success-tertiary);border-color:transparent}
.ci-alert.warning{background:var(--dsw-alias-state-warn-tertiary);border-color:transparent}
.ci-alert.danger{background:var(--dsw-alias-interactive-bg-hover-danger);border-color:transparent}
.ci-alert.info{background:var(--dsw-alias-state-business-tertiary);border-color:transparent}
.ci-alert-t{font-weight:600;margin-bottom:2px}
.ci-md p{margin:0 0 6px}.ci-md ul,.ci-md ol{margin:0 0 6px;padding-left:20px}.ci-md h1,.ci-md h2,.ci-md h3,.ci-md h4{margin:8px 0 6px;font-size:14px}
.ci-md a{color:var(--dsw-alias-brand-primary-new-colorprimary-new-color)}
.ci-note{color:var(--dsw-alias-label-tertiary);font-size:11.5px;margin-top:6px}
.ci-cfg-item{list-style:none;margin:0;padding:0;min-width:0}
.ci-cfg{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);border-radius:12px;overflow:hidden}
.ci-cfg[open]{background:var(--dsw-alias-bg-layer-2)}
.ci-cfg-h{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;padding:14px 16px}
.ci-cfg-h::-webkit-details-marker{display:none}
.ci-cfg-n{font-size:15px;font-weight:600}
.ci-cfg-d{color:var(--dsw-alias-label-tertiary);font-size:13px}
.ci-cfg-b{border-top:1px solid var(--dsw-alias-border-l2);margin:0 16px;padding:10px 0 14px;display:flex;flex-direction:column;gap:10px}
.ci-acct{display:flex;align-items:center;gap:10px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:10px 12px;background:var(--dsw-alias-bg-layer-1);flex-wrap:wrap}
.ci-acct-main{flex:1;min-width:180px}
.ci-acct-id{font-weight:600}
.ci-acct-sub{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.ci-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px;border:1px dashed var(--dsw-alias-border-l2);border-radius:10px;padding:12px}
.ci-field{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ci-field input,.ci-field select{border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-3);color:var(--dsw-alias-label-primary);height:32px;border-radius:8px;padding:0 10px;font:inherit;font-size:13px}
.ci-field.check{flex-direction:row;align-items:center;gap:6px}
.ci-form-ft{grid-column:1/-1;display:flex;gap:8px;justify-content:flex-end;align-items:center}
.ci-hint{font-size:12px;color:var(--dsw-alias-label-caption);margin:0}
`
