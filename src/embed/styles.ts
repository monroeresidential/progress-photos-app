export const STYLES = `
:host { display: block; background: var(--pf-bg, transparent); color: var(--pf-text, currentColor); font-family: var(--pf-font, inherit); }
* { box-sizing: border-box; }
.day { margin: 0 0 calc(var(--pf-gap, 8px) * 3); }
.day-heading { font-family: var(--pf-heading-font, inherit); text-transform: var(--pf-heading-transform, none); font-size: 1.125em; margin: 0 0 var(--pf-gap, 8px); }
.grid { display: grid; gap: var(--pf-gap, 8px); grid-template-columns: repeat(auto-fill, minmax(min(100%, var(--pf-columns-min, 280px)), 1fr)); }
.photo { margin: 0; }
.open { display: block; width: 100%; padding: 0; border: 0; background: none; cursor: zoom-in; }
.open:focus-visible { outline: 2px solid var(--pf-accent, currentColor); outline-offset: 2px; }
.open img { display: block; width: 100%; height: auto; border-radius: var(--pf-radius, 0); }
.caption { margin-top: 4px; font-size: .9em; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }
.status { padding: 16px 0; text-align: center; color: var(--pf-muted, color-mix(in srgb, currentColor 60%, transparent)); }
.retry { margin-left: 8px; font: inherit; color: var(--pf-accent, currentColor); background: none; border: 1px solid currentColor; border-radius: var(--pf-radius, 0); padding: 4px 12px; cursor: pointer; }
.sentinel { height: 1px; }
.overlay { position: fixed; inset: 0; z-index: 2147483000; background: var(--pf-overlay-bg, rgba(0,0,0,.92)); color: #fff; display: flex; align-items: center; justify-content: center; touch-action: pan-y; }
.overlay[hidden] { display: none; }
.overlay figure { margin: 0; max-width: 100vw; max-height: 100vh; display: flex; flex-direction: column; align-items: center; }
.viewer-stage { position: relative; display: flex; justify-content: center; }
.viewer-img { display: block; max-width: 100vw; max-height: calc(100vh - 64px); width: auto; height: auto; object-fit: contain; transition: opacity .15s; }
.viewer-stage.loading .viewer-img { opacity: 0; transition: none; }
.viewer-spinner { display: none; position: absolute; top: 50%; left: 50%; width: 32px; height: 32px; margin: -16px 0 0 -16px; border: 3px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; opacity: 0; }
/* Shown only after 150 ms, so instant (cached/preloaded) steps don't flash it. */
.viewer-stage.loading .viewer-spinner { display: block; animation: pf-spin .8s linear infinite, pf-show 0s .15s forwards; }
@keyframes pf-spin { to { transform: rotate(360deg); } }
@keyframes pf-show { to { opacity: 1; } }
.viewer-caption { padding: 8px 16px; text-align: center; }
.viewer-counter { margin-right: 12px; font-variant-numeric: tabular-nums; opacity: .75; white-space: nowrap; }
.overlay button { position: absolute; display: flex; align-items: center; justify-content: center; padding: 0; width: 56px; height: 56px; border-radius: 50%; color: #fff; background: rgba(0,0,0,.6); border: 1px solid rgba(255,255,255,.35); cursor: pointer; }
.overlay button svg { width: 28px; height: 28px; fill: none; stroke: currentColor; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; }
.overlay button:hover:not(:disabled), .overlay button:focus-visible { color: var(--pf-accent, #fff); border-color: var(--pf-accent, #fff); background: rgba(0,0,0,.75); }
.overlay button:focus-visible { outline: 2px solid var(--pf-accent, #fff); outline-offset: 2px; }
.overlay button:disabled { opacity: .35; cursor: default; }
.close { top: max(12px, env(safe-area-inset-top)); right: max(12px, env(safe-area-inset-right)); }
.prev { left: max(12px, env(safe-area-inset-left)); top: 50%; transform: translateY(-50%); }
.next { right: max(12px, env(safe-area-inset-right)); top: 50%; transform: translateY(-50%); }
`;
