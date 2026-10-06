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
.viewer-img { max-width: 100vw; max-height: calc(100vh - 64px); width: auto; height: auto; object-fit: contain; }
.viewer-caption { padding: 8px 16px; text-align: center; }
.overlay button { position: absolute; font: inherit; font-size: 32px; line-height: 1; color: #fff; background: rgba(0,0,0,.4); border: 0; width: 48px; height: 48px; cursor: pointer; }
.overlay button:disabled { opacity: .3; cursor: default; }
.overlay button:focus-visible { outline: 2px solid #fff; }
.close { top: 8px; right: 8px; }
.prev { left: 8px; top: 50%; transform: translateY(-50%); }
.next { right: 8px; top: 50%; transform: translateY(-50%); }
`;
