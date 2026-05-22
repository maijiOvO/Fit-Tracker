# Screenshots

Drop application screenshots in this folder. The main `README.md` already references the file names below — add the images and they will render automatically.

## What to capture

| File name | What to show | Suggested device |
|---|---|---|
| `01-pr-hub.png` | The **PR Hub** (Dashboard) with a few real personal records visible. The strongest single image for the README — show that this is data-rich and well-organised. | 390 × 844 (iPhone 14 Pro) **or** 1280 × 800 desktop |
| `02-workout.png` | An **active workout session** — the exercise card with set logging, rest timer, sub-sets / pyramid. Showcase the day-to-day usage. | Same as above |
| `03-schedule.png` | The **Schedule view** with a few planned and completed sessions (week or month view). | Same as above |
| `04-assistant.png` | The **AI Assistant** mid-conversation, ideally with a tool-call card showing it reading data or proposing a schedule entry. | Same as above |

## Optional extras

- `05-goals.png` — Goals tab with active goals + progress.
- `06-heatmap.png` — Calendar heatmap zoomed in.
- `07-android.png` — A real phone shot or Android emulator capture showing it runs natively.
- `hero.gif` — A short looping GIF (5–8 seconds) of the most expressive interaction. Optional but very effective on GitHub.

## Capture guidelines

- **Real data, not lorem-ipsum.** Use your own training data — recruiters can tell when it's fake. If you don't want exact numbers shown, blur weights but keep exercise names visible.
- **Light mode preferred** for README defaults (better thumbnail readability on GitHub). Add a dark-mode pair only if it tells a different story.
- **PNG, not JPG.** UI screenshots compress poorly as JPG.
- **Crop tightly** — no browser chrome, no OS chrome, no big empty areas. The chart / list / state should fill most of the frame.
- **Width ≤ 1600 px**, file size ≤ 400 KB each. Larger images make `git clone` slow without adding value.
- **Consistent device frame** is optional but unifies the look — use [`mockup.photos`](https://mockup.photos/), [Cleanmock](https://cleanmock.com/), or just a phone frame from Figma.

## Capturing from the Android build

The fastest way to get clean mobile shots is from the Android device itself (no emulator scaling):

```bash
# With a phone connected via ADB and the app open at the screen you want:
adb exec-out screencap -p > docs/screenshots/01-pr-hub.png
```

Then crop / resize in any image tool.

## Capturing from the desktop build

```bash
npm run dev
# Open http://localhost:5173 at the right viewport (DevTools → device toolbar)
# Use the browser's full-page screenshot:
#   Chrome: Cmd/Ctrl + Shift + P → "Capture screenshot" (visible area or full size)
```

## After adding screenshots

Commit them with a message like:

```bash
git add docs/screenshots/*.png
git commit -m "docs: add app screenshots to README"
git push
```

The main README will automatically display them — no further edits needed.
