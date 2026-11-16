export const STYLE_ID = 'dsh-cloud-infra-style'

/** Tencent Cloud console (Tea) visual language: palette, sizes and square corners, light and dark. */
export const TOKENS_LIGHT = `--ci-primary:#006eff;--ci-primary-hover:#2a86ff;--ci-text:rgba(0,0,0,0.9);--ci-strong:#000;--ci-label:rgba(0,0,0,0.4);--ci-weak:rgba(0,0,0,0.25);
--ci-bg:#fff;--ci-bg-sub:#f3f4f7;--ci-hover:#f3f4f7;--ci-btn-hover:#ebeef2;--ci-disabled:#e7eaef;--ci-border:#e7eaef;--ci-border-strong:#cfd5de;
--ci-success:#0abf5b;--ci-danger:#e54545;--ci-warning:#ff7200;--ci-info:#006eff;
--ci-info-bg:#d5e7ff;--ci-info-fg:#002da0;--ci-success-bg:#d6f4e4;--ci-success-fg:#06774a;--ci-warning-bg:#ffe8d5;--ci-warning-fg:#a02800;--ci-danger-bg:#fbe0e0;--ci-danger-fg:#9c1f3b;
--ci-tag-bg:#f3f4f7;--ci-tag-fg:#000;--ci-shadow:0 2px 4px 0 rgba(54,58,80,0.32)`

export const TOKENS_DARK = `--ci-primary:#2684ff;--ci-primary-hover:#4a99ff;--ci-text:rgba(211,222,235,0.9);--ci-strong:#fff;--ci-label:rgba(211,222,235,0.6);--ci-weak:rgba(211,222,235,0.4);
--ci-bg:#1e222d;--ci-bg-sub:#262f3e;--ci-hover:#262f3e;--ci-btn-hover:#262f3e;--ci-disabled:#262f3e;--ci-border:#344158;--ci-border-strong:#344158;
--ci-success:#5dbe8a;--ci-danger:#d27c7e;--ci-warning:#e6c979;--ci-info:#2684ff;
--ci-info-bg:#0935ad;--ci-info-fg:#6eadff;--ci-success-bg:#07623f;--ci-success-fg:#5dbe8a;--ci-warning-bg:#8c581e;--ci-warning-fg:#e6c979;--ci-danger-bg:#742536;--ci-danger-fg:#d27c7e;
--ci-tag-bg:#344158;--ci-tag-fg:#fff;--ci-shadow:0 0 1px 0 #000`

export const CSS = `
[data-step-process-body]:has(.ci-view){max-height:none;overflow:visible}
.ci-root{${TOKENS_LIGHT};font-family:inherit;color:var(--ci-text);font-size:12px;line-height:1.5;min-width:0}
body[data-ds-dark-theme] .ci-root{${TOKENS_DARK}}
.ci-root *{box-sizing:border-box}
.ci-tool{margin:4px 0 8px;border:1px solid var(--ci-border);background:var(--ci-bg)}
.ci-tool-head{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;cursor:pointer;user-select:none;min-width:0;background:transparent;border:0;width:100%;font:inherit;color:inherit;text-align:left}
.ci-tool-head:hover{background:var(--ci-hover)}
.ci-tool-title{font-weight:700;color:var(--ci-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-tool-sub{color:var(--ci-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.ci-tool-body{border-top:1px solid var(--ci-border);padding:12px}
.ci-chev{width:12px;height:12px;flex:none;color:var(--ci-label);transition:transform .15s}
.ci-chev.open{transform:rotate(90deg)}
.ci-badge{display:inline-flex;align-items:center;gap:5px;padding:0 7px;line-height:18px;font-size:12px;white-space:nowrap;background:var(--ci-tag-bg);color:var(--ci-tag-fg);border:1px solid var(--ci-tag-bg);flex:none;margin:1px 4px 1px 0}
.ci-badge.success{background:var(--ci-success-bg);border-color:var(--ci-success-bg);color:var(--ci-success-fg)}
.ci-badge.warning{background:var(--ci-warning-bg);border-color:var(--ci-warning-bg);color:var(--ci-warning-fg)}
.ci-badge.danger{background:var(--ci-danger-bg);border-color:var(--ci-danger-bg);color:var(--ci-danger-fg)}
.ci-badge.info{background:var(--ci-info-bg);border-color:var(--ci-info-bg);color:var(--ci-info-fg)}
.ci-badge.st{background:transparent;border-color:transparent;padding:0;color:var(--ci-text)}
.ci-dot{width:8px;height:8px;border-radius:50%;background:var(--ci-weak);flex:none}
.ci-badge.st.success .ci-dot{background:var(--ci-success)}
.ci-badge.st.warning .ci-dot{background:var(--ci-warning)}
.ci-badge.st.danger .ci-dot{background:var(--ci-danger)}
.ci-badge.st.info .ci-dot{background:var(--ci-info)}
.ci-spin{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:ci-spin .7s linear infinite;flex:none;color:var(--ci-primary)}
@keyframes ci-spin{to{transform:rotate(360deg)}}
.ci-meta{display:flex;flex-wrap:wrap;gap:6px 20px;color:var(--ci-label);margin-bottom:10px}
.ci-meta b{color:var(--ci-text);font-weight:400;margin-left:8px}
.ci-pre{margin:0;padding:10px 12px;background:var(--ci-bg-sub);color:var(--ci-text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all}
.ci-more{appearance:none;border:0;background:transparent;color:var(--ci-primary);cursor:pointer;font:inherit;padding:6px 0 0}
.ci-more:hover{text-decoration:underline}
.ci-err{color:var(--ci-danger);white-space:pre-wrap;word-break:break-word}
.ci-view{padding:2px 0}
.ci-view-title{font-size:16px;font-weight:700;color:var(--ci-strong);margin:2px 0 12px}
.ci-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.ci-sec-t{font-weight:700;font-size:14px;color:var(--ci-strong);margin:0 0 10px}
.ci-tabs{display:flex;flex-wrap:wrap;gap:0 20px;border-bottom:1px solid var(--ci-border);margin-bottom:14px}
.ci-tab{appearance:none;position:relative;border:0;background:transparent;height:30px;line-height:30px;padding:0 10px;cursor:pointer;color:var(--ci-strong);font:inherit;font-size:14px;white-space:nowrap}
.ci-tab::after{content:"";position:absolute;left:0;bottom:-1px;width:0;border-bottom:2px solid transparent;transition:width .15s ease-in-out,border-color .15s ease-in-out}
.ci-tab:hover::after,.ci-tab.on::after{width:100%;border-bottom-color:var(--ci-primary)}
.ci-tab.on{font-weight:700}
.ci-table-wrap{overflow-x:auto;overflow-y:hidden;background:var(--ci-bg)}
.ci-table{border-collapse:collapse;width:100%;font-size:12px}
.ci-table th{text-align:left;font-weight:400;color:var(--ci-label);padding:10px;border-bottom:1px solid var(--ci-border-strong);white-space:nowrap;cursor:pointer;user-select:none}
.ci-table th:hover{color:var(--ci-text)}
.ci-table th .ci-sort{margin-left:4px;color:var(--ci-primary)}
.ci-table td{padding:12px 10px;border-bottom:1px solid var(--ci-border);color:var(--ci-text);vertical-align:middle;max-width:420px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;transition:background-color .1s linear}
.ci-table tbody tr:hover td{background:var(--ci-hover)}
.ci-table td.empty{text-align:center;color:var(--ci-label);padding:28px 10px}
.ci-tbar{display:flex;align-items:center;gap:10px;margin-bottom:10px;color:var(--ci-label)}
.ci-tbar .ci-grow{flex:1}
.ci-input,.ci-tbar input{height:30px;border:1px solid var(--ci-border-strong);background:var(--ci-bg);color:var(--ci-text);padding:0 10px;font:inherit;font-size:12px;border-radius:0;outline:none;min-width:0;width:220px;transition:border-color .2s}
.ci-input:hover,.ci-tbar input:hover,.ci-input:focus,.ci-tbar input:focus{border-color:var(--ci-primary)}
.ci-pager{display:flex;align-items:center;gap:10px;padding:10px 0 0;color:var(--ci-label)}
.ci-pager .ci-grow{flex:1}
.ci-turn{appearance:none;width:26px;height:26px;display:inline-flex;align-items:center;justify-content:center;border:1px solid var(--ci-border-strong);background:var(--ci-bg);color:var(--ci-strong);cursor:pointer;font:inherit;padding:0}
.ci-turn+.ci-turn{margin-left:-11px}
.ci-turn:hover:not(:disabled){background:var(--ci-btn-hover)}
.ci-turn:disabled{cursor:not-allowed;background:var(--ci-disabled);color:var(--ci-weak)}
.ci-btn{appearance:none;height:30px;min-width:24px;padding:0 20px;border:1px solid var(--ci-border-strong);background:var(--ci-bg);color:var(--ci-primary);border-radius:0;cursor:pointer;font:inherit;font-size:12px;line-height:28px;white-space:nowrap;transition:background-color .2s,border-color .2s}
.ci-btn:hover:not(:disabled){background:var(--ci-btn-hover)}
.ci-btn:disabled{cursor:not-allowed;background:var(--ci-disabled);border-color:var(--ci-disabled);color:var(--ci-weak)}
.ci-btn.primary{background:var(--ci-primary);border-color:var(--ci-primary);color:#fff}
.ci-btn.primary:hover:not(:disabled){background:var(--ci-primary-hover);border-color:var(--ci-primary-hover)}
.ci-btn.danger{color:var(--ci-danger)}
a.ci-btn{text-decoration:none;display:inline-flex;align-items:center;flex:none}
.ci-kv{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,280px),1fr));gap:12px 24px}
.ci-kv-i{display:flex;gap:12px;min-width:0;align-items:baseline}
.ci-kv-l{color:var(--ci-label);flex:none;min-width:72px}
.ci-kv-v{word-break:break-all;color:var(--ci-text);min-width:0}
.ci-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));background:var(--ci-bg);box-shadow:var(--ci-shadow);overflow:hidden}
.ci-stat{padding:16px 20px;min-width:0;border-left:1px solid var(--ci-border);margin:12px 0 12px -1px}
.ci-stat-l{color:var(--ci-label)}
.ci-stat-v{font-size:24px;font-weight:700;color:var(--ci-strong);font-variant-numeric:tabular-nums;line-height:1.4;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-stat-v small{font-size:12px;font-weight:400;color:var(--ci-label);margin-left:4px}
.ci-stat.success .ci-stat-v{color:var(--ci-success)}
.ci-stat.warning .ci-stat-v{color:var(--ci-warning)}
.ci-stat.danger .ci-stat-v{color:var(--ci-danger)}
.ci-stat.info .ci-stat-v{color:var(--ci-info)}
.ci-chart{width:100%;min-height:120px;position:relative}
.ci-chart-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ci-label)}
.ci-note{color:var(--ci-label);margin-top:8px}
.ci-cfg-item{list-style:none;margin:0;padding:0;min-width:0}
.ci-cfg{background:var(--ci-bg);box-shadow:var(--ci-shadow)}
.ci-cfg-h{display:flex;align-items:center;gap:12px;cursor:pointer;list-style:none;padding:16px 20px}
.ci-cfg-h::-webkit-details-marker{display:none}
.ci-cfg-n{font-size:14px;font-weight:700;color:var(--ci-strong)}
.ci-cfg-d{color:var(--ci-label)}
.ci-cfg-b{border-top:1px solid var(--ci-border);padding:16px 20px 20px;display:flex;flex-direction:column;gap:12px}
.ci-acct{display:flex;align-items:center;gap:10px;border-bottom:1px solid var(--ci-border);padding:4px 0 14px;flex-wrap:wrap}
.ci-acct-main{flex:1;min-width:180px}
.ci-acct-id{font-weight:700;color:var(--ci-strong);font-size:14px}
.ci-acct-sub{color:var(--ci-label)}
.ci-form{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px 20px;background:var(--ci-bg-sub);padding:16px 20px}
.ci-field{display:flex;flex-direction:column;gap:6px;color:var(--ci-label)}
.ci-field input,.ci-field select{height:30px;border:1px solid var(--ci-border-strong);background:var(--ci-bg);color:var(--ci-text);border-radius:0;padding:0 10px;font:inherit;font-size:12px;outline:none}
.ci-field input:hover,.ci-field input:focus,.ci-field select:hover,.ci-field select:focus{border-color:var(--ci-primary)}
.ci-field.check{flex-direction:row;align-items:center;gap:6px;color:var(--ci-text)}
.ci-field.check input{height:auto}
.ci-form-ft{grid-column:1/-1;display:flex;gap:10px;justify-content:flex-start;align-items:center}
.ci-hint{color:var(--ci-label);margin:0}
`
