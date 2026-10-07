# Upload App Reskin ("Journal") — Design

**Date:** 2026-10-07
**Status:** Approved in conversation; awaiting written-spec review
**Branch:** `feat/app-reskin`
**Design source:** `design_handoff_progress_photos/` (README + `screens/1a-*.png`; `design/Progress Photos.dc.html` option 1a, and option 1b for Select mode only)
**Builds on:** `docs/specs/2026-10-06-progress-photos-design.md`

## Purpose

Make the uploader (`src/app/`) feel like a native iPhone app in Monroe's navy, and make it faster to use on site. The two tabs (Upload, Manage) stay. These features are new:

- **Take photo** (camera) next to **Library**.
- **Area tags** on a batch ("4th floor", "Lobby", …), stored as real data.
- **Manage** grouped by day, with large photos and hidden photos clearly marked.
- A full-screen dark **viewer**, opened by tapping a photo. The caption, Hide/Unhide and Delete controls move into it.
- **Select mode** for bulk Hide / Caption / Delete.

### Success criteria

1. Matches the handoff screens at 393×852 in light and dark mode: sizes, type, colors, radii and spacing. Any width works as a single column with 20px side padding.
2. Every existing upload safeguard still works:
   - one-at-a-time processing;
   - the 60 s stall timeout and Retry;
   - Duplicate detection;
   - pausing on an expired sign-in with "Sign in again";
   - the batch caption clearing when a batch finishes;
   - the project picker being locked while uploading;
   - remembering the last-used project.
3. An area chosen at upload is stored with each photo and shown as "8:52 AM · 4th floor" in Manage and the viewer.
4. The public feed, the `<progress-feed>` embed and pinned embed releases are unchanged.
5. All existing tests pass (rewritten where they target old markup), plus new tests for every feature above.

### Out of scope

- Option 1b's grid layout.
- An area editor in the viewer. The API accepts `area` on PATCH, but no screen uses it yet.
- Area in the public feed or embed.
- More than one area per photo.
- A bulk API endpoint.

## Decisions

| Decision | Choice |
|---|---|
| Where area lives | New `photos.area` column; real API field (not folded into the caption) |
| Area choices | Learned from the project's photos, most-used first; "+ Add" types a new one, which is kept once a photo uses it |
| Areas per photo | One, optional; tapping the selected pill clears it |
| Area after a batch | Stays selected (the next batch is usually the same area); the batch caption still clears |
| Bulk actions | Done in the app: one PATCH/DELETE per photo, up to 4 at a time, a single confirmation for delete |
| UI stack | Vanilla TS with the existing `h()` builder (`dom.ts`) and API client; no new dependencies |

## Section 1 — Data and API

### Migration `migrations/0002_area.sql`

```sql
ALTER TABLE photos ADD COLUMN area TEXT;
CREATE INDEX photos_area ON photos (project_slug, area);
```

Existing photos keep `area = NULL`.

### Validation (shared)

`normalizeArea(input)`:
- trim the value; an empty string or no value means `null`;
- more than 40 characters → `400 { error: "bad_request", message: "Area must be 40 characters or fewer" }`;
- the text is otherwise free-form, and case is preserved as typed.

### Endpoints

- **`POST /api/admin/photos`** accepts an optional multipart field `area`, which is normalized and stored. A duplicate upload returns the existing id and keeps that photo's original area.
- **`PATCH /api/admin/photos/:id`** accepts `area: string | null` alongside `caption` and `hidden`, validated the same way. A body containing only `area` is valid.
- **`GET /api/admin/photos`**: each `AdminPhoto` gains `area: string | null`.
- **`GET /api/admin/projects/:slug/areas`** (new, behind Access):
  - returns `[{ area: string, count: number }]`, covering all of the project's photos including hidden ones, where `area IS NOT NULL`;
  - sorted by `count DESC, area ASC`, with at most 20 entries;
  - an unknown project returns 404 `unknown_project`.
- **Public `GET /api/feed/:project`**: unchanged. `FeedPhoto` doesn't get `area`, and `toFeedPhoto` doesn't add it.

### Types (`src/shared/types.ts`)

- `AdminPhoto` gains `area: string | null`.
- A new type: `AreaCount { area: string; count: number }`.

## Section 2 — App structure

All files live in `src/app/`. `style.css` is replaced by `theme.css`.

| File | Responsibility |
|---|---|
| `theme.css` | Light and dark tokens (below), and the base components: primary/secondary/ghost buttons, segmented control, fields, pills, focus ring, hairline. Uses safe-area insets instead of the mock's fixed 62px top and 44px bottom. |
| `icons.ts` | `icon(name, size)` → inline SVG built from embedded Lucide paths: camera, image, x, chevron-down, external-link, eye-off, eye, more-horizontal, trash-2, pencil, check, plus. |
| `header.ts` | The title "Monroe Residential Progress Photos"; the project `<select>` styled as a 22px/700 title with a chevron (locked while uploading); a right-hand slot ("Live site" pill on Upload, linking to the project's `siteUrl` in a new tab and shown only for http(s) URLs; "Select" ghost button on Manage; Cancel / "N selected" / All in select mode); and the Upload/Manage segmented control with a 150ms switch. |
| `upload.ts` | Upload tab (details below). |
| `manage.ts` | Manage tab: day groups and cards, opening the viewer and the "⋯" action sheet, Load more. |
| `days.ts` | Pure functions: `groupByDay(photos)`, `dayLabel(key)` ("Sunday, October 5"), `dayCounts` ("4 photos · 3 live"), `timeLabel(takenAt)` ("8:52 AM"), and `timeRange(dates)` ("Oct 5, 8:51–8:52 AM"). Unit-tested. |
| `viewer.ts` | The admin viewer (details below). It is separate from the embed's viewer but uses the same stale-image guard. |
| `select.ts` | Select-mode state (`selectedIds`) and the bulk Hide / Caption / Delete footer. |
| `api.ts` | Adds `api.areas(slug)`, the `area` argument on `uploadPhoto`, and `area` on `api.patch`. |
| `main.ts` | App shell: loads projects, remembers the last-used one, switches tabs, and connects the header to select mode. |

### Upload tab

- **Action row:**
  - "Take photo": primary button, flex 1.4, 56px; an `<input type=file accept="image/*" capture="environment">`.
  - "Library": secondary button, flex 1; the same input without `capture`.
- **Caption for this batch:** a field with a 13px/600 label at 60% opacity; the input is 44px tall, 17px text, on the fill color, radius 10.
- **Area:**
  - Pills come from `/areas` for the current project and reload when the project changes.
  - The selected pill uses the light brand fill with brand-colored text; others have a 1px divider-colored border.
  - "+ Add" has a dashed border at 70% opacity and opens an inline text input. Enter or blur adds the pill and selects it; Esc cancels.
  - Tapping the selected pill clears the area.
- **Queue:**
  - Header: "3 PHOTOS · 1 UPLOADING" (13px/600, uppercase, letter-spacing .04em, 60% opacity), with `timeRange` of the photos' capture times on the right. Capture times come from EXIF, using the existing `readJpegMeta` with a `lastModified` fallback.
  - Rows: a `72px 1fr 44px` grid; a 72×72 cover thumbnail with radius 10; a 40px "Caption (overrides batch)" input; a 12px status line; and a 44×44 ✕ remove button.
  - Status:
    - "Ready" at 60% opacity.
    - "Uploading…" in brand color with a 2px progress bar (divider-colored track, brand fill).
    - **Done** rows fade out and are removed.
    - "Duplicate (already uploaded)" behaves like Done.
    - **Failed** shows its message in danger red; tapping the row retries.
    - "Can't read this photo" stays, in danger red, with ✕ to remove.
    - Sign-in expiry stops the queue and shows the notice with "Sign in again" (kept from today).
- **Footer:** sticky, with a top divider; padding 16px 20px, plus the bottom safe-area inset. A full-width 52px primary button reads "Upload N photos" (N = ready rows) and is disabled at 0.
- **Batch rules (kept):**
  - The caption and area are captured when Upload is tapped.
  - When the batch finishes, the caption clears and the area stays.
  - The next photos picked start a fresh queue.

### Manage tab

- **Body:** padding 22px 20px 60px, with 28px between day groups.
- **Day header:** `dayLabel` at 20px/600, `dayCounts` at 12px/60% on the right, and a bottom divider.
- **Cards:**
  - A full-width 4:3 cover image with radius 14.
  - Below it, a `1fr 44px` grid: the caption (15px), a meta line of `time · area` (12px, 55% opacity; the area part is omitted when null), and a 44×44 "⋯" button.
  - Tapping the image opens the viewer.
  - "⋯" opens an action sheet with Edit caption (opens the viewer), Hide/Unhide, and Delete.
- **Hidden photos:** the image and caption are dimmed to 40%, with a "Hidden from site" tag (eye-off icon, 28px tall) 14px from the top-left.
- **Loading:** the list starts with the first page from `/api/admin/photos` and adds a "Load more" button while `nextCursor` is set. A new page merges into an existing day group when the day matches.
- **Errors:** "Your sign-in expired…" or a network error is shown inline with a Retry button.

### Viewer (always dark)

- **Colors:** background `#00051B`, text `#f2f4fa`.
- **Opening and closing:** opens with a 200ms fade; the page behind can't scroll while it's open; focus is trapped in the viewer and returns to the card when it closes.
- **Top bar:** a 44×44 close button with a 22px ✕, and in the center "2 of 4 · Sunday, Oct 5" (13px, 70% opacity, tabular numerals). Positions count across all loaded photos, hidden ones included.
- **Image:** fills the remaining height using `object-fit: contain`.
- **Stale-image guard:**
  - The image is hidden until the new photo has decoded.
  - A render number ensures a slow earlier load can't reveal itself.
  - The photos on either side are preloaded.
  - The approach is the same as the embed's 1.0.1 fix.
- **Bottom sheet:** a top border at `rgba(242,244,250,.15)`, padding 18px 20px plus the bottom safe-area inset, and 14px gaps.
  - **Meta row:** "8:51:57 AM · 4th floor", plus a status tag: "Live on site" (check icon, background `#1a2350`, text `#dde3ff`) or "Hidden".
  - **Caption:** an input at least 44px tall, 15px text, background `#0f1530`, radius 10.
  - **Buttons:** 48px tall, 15px/600, radius 12, 10px apart.
    - Hide/Unhide: flex 1, background `#161d3a`.
    - Delete: flex 1, background `#161d3a`. It asks "Delete this photo? This can't be undone." When confirmed, the viewer moves to the next photo, or closes if there is none.
    - Save caption: flex 1.3, background `#f2f4fa`, navy text. It is disabled until the caption changes and shows "Saved" briefly afterwards.
- **Delete messages:** a failed purge or object delete shows the same messages as today, in the sheet.
- **Navigation:** swipe, ←/→ and Esc. At the last loaded photo, the viewer loads the next page.
- **Updates:** every change updates the Manage list in place.

### Select mode

- **Entering and leaving:** the header's "Select" button enters select mode; Cancel leaves it, as does switching tab or project.
- **Header:** Cancel | "N selected" (17px/600) | "All", which selects every loaded photo (it reads "None" once all are selected).
- **Cards:** each card gets a 24px circle top-right with a white 1.5px border. When selected, it is filled with brand color and shows a check, and the card gets a 2px brand outline. Tapping a card toggles it instead of opening the viewer.
- **Footer:** sticky, with Hide / Caption / Delete as 52px secondary buttons, disabled when nothing is selected.
  - **Hide:** if every selected photo is already hidden, the button reads "Unhide".
  - **Caption:** opens a small sheet with one input and "Apply to N photos".
  - **Delete:** asks once, "Delete N photos? This can't be undone."
- **Running a bulk action:**
  - Requests run 4 at a time, with progress shown in the footer ("Deleting 3 of 7…").
  - On partial failure, the photos that succeeded update in place, and the rest stay selected with a message: "2 couldn't be updated — Retry".
  - On sign-in expiry, the action stops and shows the sign-in notice.

## Design tokens (`theme.css`)

**Light (default):**

| Token | Value |
|---|---|
| `--brand` | `#00051B` |
| `--brand-100` | `#e8eaf1` |
| `--bg` | `#f5f6f8` |
| `--surface` | `#ffffff` |
| `--text` | `#0b0f1f` |
| `--fill` | `#e9ebf0` |
| `--divider` | `rgba(11,15,31,.12)` |
| `--danger` | `#b42318` |

**Dark** (`@media (prefers-color-scheme: dark)`):

| Token | Value |
|---|---|
| `--bg` | `#00051B` |
| `--surface` | `#0f1530` |
| `--text` | `#f2f4fa` |
| `--fill` | `#161d3a` |
| `--divider` | `rgba(242,244,250,.18)` |
| `--brand` | `#9fb3ff` |
| `--brand-100` | `#1a2350` |

**Type:** `-apple-system, BlinkMacSystemFont, system-ui, sans-serif`; body 17px with line-height 1.35; sizes 11/12/13/14/15/17/20/22; tabular numerals for times and counts.

**Radii:**

| Size | Used for |
|---|---|
| 8 | Segmented control option |
| 10 | Inputs, segmented track, thumbnails |
| 12 | Buttons |
| 14 | Cards and photos |
| 999 | Pills |

**Buttons:** all weight 600 with a hit target of at least 44px.
- Primary: `--brand` fill with white text (navy text on the light-blue dark-mode brand).
- Secondary: `--fill` with `--text`.
- Ghost: transparent with `--brand` text.
- Focus ring: 2px `--brand`, offset 2.

**Motion:** the segmented switch takes 150ms, the viewer fades in over 200ms, and Done rows fade out. Nothing else animates. `prefers-reduced-motion` disables all three.

**Theme meta:** `<meta name="theme-color">` gets a light and a dark value; the manifest's `theme_color` becomes `#00051B`.

## Error handling

| Situation | Behaviour |
|---|---|
| Area longer than 40 characters (upload or PATCH) | Server returns 400; the app limits the input to 40 characters, so this only happens for a hand-made request |
| `/areas` fails | The pill row shows only "+ Add"; uploading still works |
| Bulk action partly fails | The successful photos update; the failed ones stay selected, with "N couldn't be updated — Retry" |
| Viewer Delete fails | An error appears in the sheet; the photo stays |
| Sign-in expires (any tab) | Same as today: "Your sign-in expired. Sign in again" (opens a new window), and "If Retry still fails, close and reopen the app." |
| Camera input unsupported (desktop) | "Take photo" falls back to the file picker, as the browser handles `capture` |

## Testing

**Worker (Vitest):**
- **Upload:** stores the area, after trimming; an empty value stores null; 41 characters returns 400; a duplicate keeps the original area.
- **PATCH:** accepts an area on its own, null clears it, 41 characters returns 400.
- **`/areas`:** ordered by count then name, includes hidden photos, excludes null, capped at 20, 404 for an unknown project, and requires Access.
- **Admin list:** includes `area`; the public feed doesn't include `area`.

**Unit (Vitest):**
- `days.ts` grouping, which uses each photo's own offset as the existing embed does;
- day and time labels, and the "N photos · M live" counts;
- `timeRange` for one time, a range within one day, and a range across days.

**Browser (Playwright, Chromium, against `wrangler dev`):** `upload.spec.ts` is rewritten for the new screens.
- Upload with a batch caption and a new area via "+ Add"; the row fades out on Done; the next upload is flagged Duplicate.
- The area pill appears from `/areas` after the first upload.
- Manage shows a day header with counts and the "time · area" line; a hidden photo shows the tag.
- Viewer: Save caption, Hide/Unhide, and Delete with confirmation; the list updates in place.
- Select mode: select 2 photos, bulk Hide and then Delete, and the counts update.
- The batch caption clears after a finished batch and the area stays.
- In dark mode (`colorScheme: "dark"`), the body background is `#00051B`.

**Visual check:** screenshots at 393×852 of Upload, Manage and Viewer in both themes, saved for comparison with `screens/1a-*.png`. These are a manual check, not part of the automated suite.

**iPhone checklist:** `docs/iphone-checklist.md` gains:
- Take photo opens the camera;
- area pills and "+ Add";
- the viewer swipe and actions;
- select mode bulk actions;
- dark mode.

## Rollout

1. Merge `feat/app-reskin`, then the push deploys staging.
2. Apply migration 0002. CI runs `d1 migrations apply` before each deploy. The column is additive, so the old app keeps working during the rollout.
3. Run the iPhone checklist on staging, then **Deploy production**.

The embed is unaffected, so no new pinned release is needed.
