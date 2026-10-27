# Real Device Acceptance

Browser automation does not certify natural multi-day care, physical-device lifecycle behavior, acoustic comfort, or human screen-reader usability. Record those separately from simulated time, imported fixtures, and DOM assertions. Do not reset, import over, or otherwise replace the player's save to prepare a run.

## Natural Growth

Use a normally played pet and keep the app closed between visits. Record the local date/time, displayed stage and growth values, sleep state, and care/play actions at each visit. Include at least one overnight absence and continue across the next natural stage transition. On return, check that elapsed needs settle once, a return summary appears only when eligible, and reopening or refreshing does not repeat growth, rewards, care actions, or the summary. Adult form and points should remain locked after adulthood. Note any unusually long absence or device clock/time-zone change; do not infer a multi-day result from a constructed age or a controlled clock.

| Visit | Local date/time + time zone | Stage / points | Sleep / needs | Actions since last visit | Return settlement / duplicate check |
|---|---|---|---|---|---|
| Start | | | | | |
| Return 1 | | | | | |
| Return 2 | | | | | |
| Stage transition | | | | | |

## Phone Background / Foreground

Record phone model, OS version, browser and version, and whether the app is an installed PWA. On a non-destructive page, background the browser for several minutes, lock and unlock the screen once, then return. Check that the page remains responsive, the visible pet state agrees with a fresh read, no old sound plays late, and no care/game action is repeated. Repeat once with the browser process discarded by the OS if practical. Do not use DevTools lifecycle emulation as the real-device result.

## Speaker / Headphone Comfort

Record device, output route, system volume, in-app sound setting, room conditions, and tester impression. Start at the lowest comfortable system volume in a quiet room. Enable sound, try several A/B/C navigation presses, one confirmation, and (if available without waiting through a long round) one automatic game cue. Increase volume only in small steps; repeat separately on the phone speaker and headphones. Verify mute takes effect immediately, backgrounding cancels pending cues, and returning does not replay them. Stop immediately for discomfort, sharpness, startling loudness, or unexpected sound; note the exact action and route. Automated frequency/gain assertions are implementation checks, not proof of perceived loudness or comfort.

| Output route | Device volume | In-app sound | Navigation / confirmation | Automatic cue | Mute / background | Comfort notes |
|---|---|---|---|---|---|---|
| Speaker | | | | | | |
| Headphones | | | | | | |

## VoiceOver / TalkBack

Record screen-reader name/version, phone/OS, browser, and verbosity settings. With the screen reader already active, navigate from the browser chrome to the app and through the LCD using swipe navigation and the screen reader's rotor/controls. Check that the pet name and stage, changing needs, selected menu item, page numbers, game instructions, pause/result state, and A/B/C labels are announced in a useful order; live updates should not repeatedly interrupt unrelated reading. Activate only the visible A/B/C controls and confirm focus remains understandable after menus, dialogs, and page changes. Check portrait at 320–390 CSS px and enlarged text; look for clipped text, focus hidden behind the browser/keyboard, and horizontal scrolling. Record confusing, missing, repeated, or excessively chatty announcements verbatim. Automated accessibility-tree checks are supporting evidence, not a human screen-reader pass.

| Screen reader / version | Device / OS | Browser | View / text size | Flow exercised | Announcement or focus issue |
|---|---|---|---|---|---|
| | | | | | |

## Result

Mark each area **Pass**, **Fail**, or **Not run**, and attach dates and observations. Keep simulated-time tests, desktop browser automation, and physical-device observations as separate evidence. A missing real device or a short observation window is **Not run**, not Pass.
