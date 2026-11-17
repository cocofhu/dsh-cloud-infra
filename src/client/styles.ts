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
.ci-root{${TOKENS_LIGHT};font-family:var(--tea-font-family-default);color:var(--ci-text);font-size:12px;line-height:1.5;min-width:0}
body[data-ds-dark-theme] .ci-root{${TOKENS_DARK}}
.ci-root *{box-sizing:border-box}
.ci-root *,[class*=tea-],[class*=tea-]::before,[class*=tea-]::after{corner-shape:round}
body{--tea-border-radius-default:var(--tea-border-radius-150);--card-border-radius:var(--tea-border-radius-200)}
.ci-tool{border-radius:8px;overflow:hidden;margin:4px 0 8px;border:1px solid var(--ci-border);background:var(--ci-bg)}
.ci-tool-head{display:flex;align-items:center;gap:8px;height:36px;padding:0 12px;cursor:pointer;user-select:none;min-width:0;background:transparent;border:0;width:100%;font:inherit;color:inherit;text-align:left}
.ci-tool-head:hover{background:var(--ci-hover)}
.ci-tool-title{font-weight:700;color:var(--ci-strong);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-tool-sub{color:var(--ci-label);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0;flex:1}
.ci-tool-body{border-top:1px solid var(--ci-border);padding:12px}
.ci-chev{width:12px;height:12px;flex:none;color:var(--ci-label);transition:transform .15s}
.ci-chev.open{transform:rotate(90deg)}
.ci-meta{display:flex;flex-wrap:wrap;gap:6px 20px;color:var(--ci-label);margin-bottom:10px}
.ci-meta b{color:var(--ci-text);font-weight:400;margin-left:8px}
.ci-pre{border-radius:6px;margin:0;padding:10px 12px;background:var(--ci-bg-sub);color:var(--ci-text);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-all}
.ci-more{appearance:none;border:0;background:transparent;color:var(--ci-primary);cursor:pointer;font:inherit;padding:6px 0 0}
.ci-more:hover{text-decoration:underline}
.ci-err{color:var(--ci-danger);white-space:pre-wrap;word-break:break-word}
.ci-view{padding:2px 0}
.ci-view-title{font-size:16px;font-weight:700;color:var(--ci-strong);margin:2px 0 12px}
.ci-col{display:flex;flex-direction:column;gap:16px;min-width:0}
.ci-chart{width:100%;min-height:120px;position:relative}
.ci-chart-ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;gap:8px;color:var(--ci-label)}
.ci-note{color:var(--ci-label);margin-top:8px}
.ci-card.tea-card{margin:0;min-width:0}
.ci-card .tea-card__body{min-width:0}
.ci-tag.tea-tag{margin:1px 4px 1px 0;flex:none}
.ci-status{display:inline-flex;align-items:center;gap:6px;white-space:nowrap}
.ci-status .tea-badge--dot{flex:none}
.ci-dot{width:6px;height:6px;border-radius:50%;background:var(--ci-weak);flex:none}
[data-approval-scroll] [class*=_headline]{white-space:pre-line}
.ci-table-scroll{overflow-x:auto;overflow-y:hidden}
.ci-table-scroll .tea-table__body td>div{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ci-tbar{display:flex;justify-content:flex-end;margin-bottom:10px}
.ci-empty{text-align:center;color:var(--ci-label);padding:20px 0}
.ci-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px 0}
.ci-stats .tea-metrics-board__header-title{line-height:20px}
.ci-stats .tea-metrics-board{min-width:0;padding:0 20px;border-left:1px solid var(--ci-border);margin-left:-1px}
.ci-kv.tea-form{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:0 24px}
.ci-kv .tea-form__item{min-width:0}
.ci-kv .tea-form__text{word-break:break-all}
.ci-cfg-item{list-style:none;margin:0;padding:0;min-width:0}
.ci-form{border-radius:8px;background:var(--ci-bg-sub);padding:16px 20px}
.ci-form .tea-input{width:320px;max-width:100%}
.ci-btns{display:flex;gap:8px;flex-wrap:wrap}
.ci-danger.tea-btn--link{color:var(--ci-danger)}
`
