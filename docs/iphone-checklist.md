# Manual iPhone checklist (staging, before each production deploy that touches the upload app or embed)

Run on a real iPhone in Safari against https://progress-staging.monroeresidential.com.

- [ ] Add to Home Screen; the icon opens full-screen with no Safari chrome.
- [ ] Sign in through Access; the project list loads.
- [ ] Camera capture of a new photo uploads; status shows "Done".
- [ ] A HEIC photo from the library uploads (Safari hands the page a JPEG).
- [ ] A 48 MP ProRAW/HEIF photo uploads without the tab reloading.
- [ ] A Live Photo uploads as a still.
- [ ] A **portrait** photo appears upright in the feed and viewer.
- [ ] A 10-photo batch over cellular completes; each item shows its own status.
- [ ] Airplane mode mid-batch: the in-flight photo shows "Failed" with Retry; later ones continue failing cleanly; turn the network back on, Retry succeeds.
- [ ] Re-select an already-uploaded photo: "Duplicate (already uploaded)".
- [ ] Leave the app until the Access session expires (or sign out in another tab), then upload: the queue stops and a "Sign in again" link appears (opens in a new window). After signing in, tap Retry and the batch resumes without re-picking photos.
- [ ] Download a 1920w file from the feed and check it has no GPS/EXIF (e.g. `exiftool`).
- [ ] The photo's date heading matches the day it was taken on site.
- [ ] Manage tab: edit caption, hide (gone from the feed within ~60 s), unhide, delete (images 404 within seconds).

## Journal reskin

- [ ] Light and dark mode follow the phone's setting; the status bar color matches.
- [ ] **Take photo** opens the camera; **Library** opens the photo library.
- [ ] Area: "+ Add" a new area, upload — the pill appears next time; tapping the selected pill clears it.
- [ ] Queue shows the capture-time range; rows fade out on Done; the batch caption clears and the area stays.
- [ ] Manage: day headers with "N photos · M live"; hidden photos dimmed with "Hidden from site".
- [ ] Viewer: swipe between photos; Save caption; Hide/Unhide; Delete asks first and moves on.
- [ ] Select: tick several, bulk Hide, bulk Caption, bulk Delete (one confirmation).
- [ ] Project title picker opens the native picker; it's locked while uploading.
