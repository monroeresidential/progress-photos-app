# Handoff: Progress Photos — direction 1a "Journal"

## Overview
Redesign of the Monroe Residential Progress Photos uploader (`src/app/` in `progress-photos-app`: `index.html`, `style.css`, `main.ts`, `upload.ts`, `manage.ts`). Same two tabs (Upload, Manage) and same API, restyled as a native-feeling iPhone web app in Monroe's navy, with these functional additions:

- Camera shortcut ("Take photo") alongside the library picker
- Area tags on a batch (4th floor, Lobby, …)
- Manage list grouped by day, large photos, hidden photos clearly marked
- Tap a photo → full-screen viewer; caption / Hide / Delete live there (replaces the per-photo Save/Hide/Delete button stack)
- Select mode for bulk Hide / Delete (header "Select" button; pattern shown in option 1b of the design file)

## About the design files
`design/Progress Photos.dc.html` is an **HTML design reference**, not production code. Recreate it in the app's existing stack (vanilla TS + the `el()` builder in `dom.ts`, `style.css`) using its current API calls. `design/Current App.dc.html` is a recreation of today's UI for comparison. Open either file directly in a browser. Option **1b** (grid layout) in the file is not being implemented; only its Select-mode screen is referenced.

## Fidelity
**High-fidelity.** Match sizes, colors, type and spacing below. Screens are mocked at 393×852 (iPhone 15/16); the layout must flow to any width (single column, 20px side padding).

## Screens
Screenshots in `screens/`.

### 1. Upload (`screens/1a-upload.png`)
Header (shared with Manage):
- Page title, centered: "Monroe Residential Progress Photos" — 17px / 600, color `--brand`, row height 44.
- Project row: project name "Birken Lofts" 22px / 700, letter-spacing -0.01em, with a chevron-down (18px, 60% opacity) — this is the project `<select>` styled as a title. Right: "Live site" pill (secondary button, 36px tall, 14px text, external-link icon) linking to the public feed. On Manage this slot holds a "Select" ghost button instead.
- Segmented control (Upload / Manage): full width, container `--fill` background, radius 10, 3px padding; options 40px tall, 15px / 600; selected option white (`--surface`), radius 8, shadow `0 1px 3px rgba(0,0,0,.12)`; unselected text 65% opacity.
- Header padding: top 62 (below status bar), sides 20.

Body (18px gap between blocks, 18px top padding):
- Action row: "Take photo" (primary, flex 1.4) + "Library" (secondary, flex 1), both 56px tall, 16px / 600, camera / image icons 20px. Take photo = `<input type=file accept="image/*" capture="environment">`; Library = same without `capture`.
- Field "Caption for this batch": label 13px / 600, 60% opacity, 6px below gap; input 44px min height, 17px text, `--fill` background, no border, radius 10, padding 10×12.
- Field "Area": pill tags 32px tall, 13px, padding 0 12, radius 999. Selected tag = `--brand-100` fill with `--brand` text; unselected = transparent with 1px `--divider` border; last is "+ Add" dashed border, 70% opacity. Sends as a prefix / metadata on the batch caption (API change optional).
- Hairline rule.
- Queue summary row: left "3 photos · 1 uploading" 13px / 600 uppercase, letter-spacing .04em, 60% opacity; right time range 12px 60%.
- Queue rows (14px gap): grid `72px 1fr 44px`, items centered. Thumbnail 72×72 cover, radius 10. Middle: per-photo caption input (40px tall, 14px, placeholder "Caption (overrides batch)") above a status line 12px: "Ready" (text at 60%) or "Uploading…" in `--brand` followed by a 2px progress bar (track `--divider`, fill `--brand`). Right: 44×44 icon button, X icon 18px, 60% opacity (remove).
- Sticky footer: top border `--divider`, padding 16 20 44; primary button full width, 52px, 17px / 600: "Upload 2 photos" (count = ready items).

### 2. Manage (`screens/1a-manage.png`)
Same header; "Select" (ghost, 44px, 14px) replaces Live site.
Body padding 22 20 60, 28px gap between day groups:
- Day header: "Sunday, October 5" 20px / 600, letter-spacing -0.01em; right "4 photos · 3 live" 12px 60% tabular; 1px `--divider` bottom border, 8px padding below. Group photos by local calendar day of `takenAt`, newest day first.
- Photo card (14px gap between cards, 6px between image and caption): image full width, aspect 4:3, cover, radius 14. Below: grid `1fr 44px` — caption 15px; meta line 12px 55% opacity: time ("8:52 AM") · area. Right: 44×44 "more" icon button (ellipsis 20px, 70% opacity) opening the same actions as the viewer.
- Hidden photo: image and caption at 40% opacity; overlay tag top-left (14px inset) "Hidden from site" with eye-off icon — 12px, 28px tall, `--fill` background, 1px `--divider` border, radius 999.
- Tapping the image opens the viewer.

### 3. Viewer (`screens/1a-viewer.png`) — always dark, full screen
- Background `#00051B`, text `#f2f4fa`.
- Top bar: padding 58 12 0; 44×44 close (X 22px) left; center "2 of 4 · Sunday, Oct 5" 13px 70% tabular; 44px spacer right. Swipe left/right moves between photos of the project.
- Image: fills remaining height, full width, `object-fit: contain` (mock shows cover 3:4).
- Bottom sheet: background `#00051B`, top border `rgba(242,244,250,.15)`, padding 18 20 48, 14px gap.
  - Row: "8:51:57 AM · 4th floor" 12px 60% | status tag "Live on site" (check icon, 11px, bg `#1a2350`, text `#dde3ff`) or "Hidden" variant.
  - Caption input: 44px min, 15px, bg `#0f1530`, radius 10, padding 8 12.
  - Button row (10px gap, 48px tall, 15px / 600, radius 12): Hide (flex 1, bg `#161d3a`, eye-off icon), Delete (flex 1, bg `#161d3a`, trash icon), Save caption (flex 1.3, bg `#f2f4fa`, text `#00051B`). Hide toggles to "Unhide" when hidden. Delete asks for confirmation.

### 4. Select mode (pattern from option 1b, third phone)
Header becomes Cancel | "2 selected" (17px / 600) | All. Each photo gets a 24px circle check top-right (white 1.5px border; filled `--brand` with check when selected; 2px `--brand` outline around the photo). Footer: Hide / Caption / Delete secondary buttons, 52px, acting on the selection.

## Interactions & behavior
- Project select persists the last choice (as today).
- Upload button disabled until ≥1 ready photo; label shows count. Per-row status: Ready → Uploading… (progress) → Done (row fades out) or Failed (status in `--danger`, retry on tap).
- Caption save is explicit (Save caption) in the viewer; the per-photo input in the upload queue overrides the batch caption.
- Hide/Unhide and Delete call the existing admin endpoints; update the list in place.
- Transitions: segmented switch 150ms ease; viewer opens with a 200ms fade; no other animation.
- Theme: follow `prefers-color-scheme`. Dark tokens below.

## State
- `projectId`, `tab` ("upload" | "manage")
- Upload: `batchCaption`, `areas: string[]`, `queue: {file, previewUrl, caption, status: ready|uploading|done|failed, progress}[]`
- Manage: `photos: AdminPhoto[]` grouped by day (derived), `viewerIndex | null`, `selectMode: boolean`, `selectedIds: Set<string>`

## Design tokens
Light (default):
- `--brand` #00051B (navy — from monroeresidential.com theme color; also used for primary buttons, selected states, active labels)
- `--brand-100` #e8eaf1 (selected tag fill)
- `--bg` #f5f6f8, `--surface` #ffffff, `--text` #0b0f1f
- `--fill` #e9ebf0 (inputs, secondary buttons, segmented track)
- `--divider` rgba(11,15,31,.12)
- `--danger` #b42318 (keep existing)
Dark:
- `--bg` #00051B, `--surface` #0f1530, `--text` #f2f4fa, `--fill` #161d3a, `--divider` rgba(242,244,250,.18), `--brand` #9fb3ff (accent on dark), `--brand-100` #1a2350
Type: `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`; body 17px / 1.35; tabular numerals for times and counts. Sizes used: 11, 12, 13, 14, 15, 17, 20, 22.
Radii: 8 (seg option), 10 (inputs, seg track, thumbnails), 12 (buttons), 14 (photo cards, cards), 999 (tags/pills).
Buttons: primary = `--brand` fill, white text; secondary = `--fill`, `--text`; ghost = transparent, `--brand` text; all 600 weight, min 44px hit target. Focus ring 2px `--brand`, offset 2.

## Assets
- Icons: Lucide (camera, image, x, chevron-down, external-link, eye-off, more-horizontal, trash-2, pencil, check).
- Photos in `design/photos/` are crops from the user's screenshots; placeholders only.

## Files
- `design/Progress Photos.dc.html` — the design (1a = implement; 1b = reference for Select mode). Opens in a browser; supporting files alongside.
- `design/Current App.dc.html` — today's UI recreated for comparison.
- `screens/1a-upload.png`, `screens/1a-manage.png`, `screens/1a-viewer.png`
