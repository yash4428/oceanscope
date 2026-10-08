# Build PRD — OceanScope Interactive Prototype
### For: Claude Code
### Goal: a beautiful, fully-interactive UI prototype. No real backend, no real data pipeline — everything is hardcoded or simulated in the browser. The only thing that matters is that it looks and feels like a finished product.

---

## 0. Read this first

This is a **UI/UX build**, not a data-engineering build. Nothing in this PRD requires a server, a database, a real NetCDF file, or a real API call anywhere. Every number, every float position, every cyclone track, every "AI" response is fabricated ahead of time by you (Claude Code) and baked into the app so it behaves consistently and convincingly. The bar is: **someone watching a 90-second demo should have no way to tell this isn't wired up to a real backend.**

Two working prototypes already exist in this project and are the starting point — **port and heavily upgrade their logic, do not start from zero**:

- `ocean-cake.html` — the 3D cake-cutting ocean scene. Real (hand-traced) coastline, seafloor, three cut planes, temperature/salinity/current volumes, ~34 Argo floats with click-to-compare profile charts, editable colorbars, mobile-responsive. **This is also your design system reference** — its fonts, colors, card style, control style, and layout language are the visual bible for every new screen you build. Read its `<style>` block before writing any new CSS.
- `sonar-quiet-zone.html` — the sonar ray-tracer, real Mackenzie equation, three presets.

Everything below is currently basic and needs real visual polish: better shading, smoother transitions, proper micro-interactions, loading/empty states, tighter spacing, and a coherent multi-screen app shell instead of one standalone page.

---

## 1. What we're building

A single-page app called **OceanScope** with a persistent navigation shell and **7 views**: the 6 feature views below, plus an AI Copilot that floats over all of them. All 7 read from and write to one shared piece of in-memory app state, so actions in one view (especially the copilot) can drive what's showing in another.

| # | View | One-line description |
|---|---|---|
| 1 | **Ocean Slicer** | The existing cake-cutting 3D scene — port, refine, keep as the anchor view |
| 2 | **Truth Meter** | Model-vs-observation disagreement, basin-wide, ranked and mapped |
| 3 | **Cyclone Lab** | Replay Cyclone Amphan day-by-day, fuel gauge, rapid-intensification risk |
| 4 | **Search & Rescue** | Drop a pin, watch a drift cloud spread, get ranked search boxes |
| 5 | **Sonar** | Quiet-zone ray tracer, now placeable anywhere in the 3D ocean |
| 6 | **Learn** | Guided Story Mode, marine life map, quizzes |
| — | **AI Copilot** | A floating command bar that can type-to-control any of the above |

---

## 2. Design system — carry this everywhere

Extract these from `ocean-cake.html` into shared CSS variables/components used by every view, not copy-pasted per screen:

- **Fonts:** `"Barlow"` for body/UI text, `"Barlow Semi Condensed"` for numerals/labels/data — both already loaded via Google Fonts in the reference file.
- **Palette:** the `--paper / --panel / --ink / --ink-2 / --rule / --land / --float / --focus / --danger` custom-property set already defined in `ocean-cake.html`. Add whatever new semantic colors each new view needs (e.g. a cyclone-alert orange, a search-and-rescue teal) but derive them from the same family — don't introduce a clashing new palette per view.
- **Components to standardize and reuse everywhere:** the segmented button group (`.seg`), the chip button (`.chip`), the primary button (`.btn`), the labeled slider row (`.row` / `.row-top` / `output`), the checkbox row (`.check`), the colorbar + tick readout, the floating tooltip (`#tip`), the side info panel (`#profile`-style card with a close button). New UI (quiz cards, cyclone lifecycle stepper, drift-probability legend, copilot bar) should look like siblings of these, not a different app.
- **Motion:** every state change animates — camera moves, value transitions, panel open/close, page switches. Nothing should hard-cut. Use easing (the reference file's `animateKnife` cubic easing is the reference quality bar). Respect `prefers-reduced-motion` as the existing file does.
- **Responsiveness:** every view must work down to a ~390px-wide phone, matching the existing file's mobile stacked layout (3D stage on top, controls below).

---

## 3. Shared app shell

Build this before porting any feature in.

- A persistent left (desktop) / bottom (mobile) navigation between the 7 views, using icon + label, matching the segmented-button visual language.
- **One shared Three.js renderer/scene**, not seven separate canvases. Switching views reconfigures what the scene shows (which layers are visible, what the camera does, whether the cake or a 2D chart is in front) rather than tearing down and rebuilding WebGL context each time — this avoids context-loss flicker and keeps switching feel instant.
- **One shared, central app-state store** (plain JS object + a tiny pub-sub is enough; use a framework's state layer if you choose to use one) holding at minimum: `currentView`, `variable` (temperature/salinity/currents/soundspeed), `depth`, `day` (for Cyclone Lab's timeline), `cutPlanes`, `selectedFloat`, `exploreMode` (bool), and `copilotLastAction`. Every view reads from this; the copilot's whole job is writing to it.
- A top bar with the app name, a global Explore-Mode toggle (simplifies language/UI app-wide, matching the pattern already in the reference file), and the copilot's collapsed entry point (see section 10).

---

## 4. View 1 — Ocean Slicer (port + polish)

Port `ocean-cake.html`'s scene in whole. This is the visual quality bar the rest of the app must hit.

**Required polish over the current version:**
- Smoother, more physically-pleasing shading on the cake faces (subtle ambient occlusion look at cut edges, softer land/seafloor texture).
- Nicer loading state (the current plain "Building the ocean…" text should become a small on-brand loader).
- Hover/active states on every clickable control, not just the browser default.
- Sharper depth/lat/lon axis labels — check they never overlap the 3D content or each other at any camera angle.
- A short empty/idle state the very first time the view loads (e.g. camera does one slow establishing rotation before settling), so the first frame the user sees isn't static.

Keep every existing interaction: knife sliders, presets, dive animation, variable switch, colorbar editing, float click → profile chart, mobile layout.

---

## 5. View 2 — Truth Meter

**Concept:** an aggregated, basin-wide view of "where the model disagrees with reality," built from the same per-float model-vs-observed data already computed in the Ocean Slicer view.

**What to simulate:** generate a smooth synthetic 3D "disagreement" scalar field over the same grid as the existing temperature/salinity volumes — reuse noise functions already in `ocean-cake.html` (`fbm`, `vnoise`) seeded so disagreement is higher near the existing eddy/upwelling regions (this makes it look scientifically plausible: models are typically worse in high-variability regions). This becomes a 5th selectable "variable" reusing the exact same cake-cutting mechanism and colorbar UI already built — same shader, new data channel, new colormap (e.g. white→amber→red, "how wrong the model is" rather than a physical quantity).

**New UI:**
- A ranked side panel: "Top 10 most-wrong locations," each row showing float ID, location, depth, and a disagreement number, sorted descending. Clicking a row flies the camera to that float and opens its existing profile-compare panel.
- A small headline stat at the top: "Basin-wide average error: 0.34°C" (or similar, computed from your synthetic data, not literally hardcoded as static text — derive it from the same generated field so changing the field changes the number).

**Acceptance criteria:**
- [ ] Switching to this view changes the cake to show the disagreement field, with its own colorbar.
- [ ] The ranked list is real (sorted, clickable) not just decorative text.
- [ ] Clicking a list row visibly moves the camera and opens the correct float's profile panel.

---

## 6. View 3 — Cyclone Lab

**Concept:** replay Cyclone Amphan (Bay of Bengal, 16–21 May 2020) day by day, showing the ocean state that fueled it.

**Hardcoded data to create:**
- A 6-point storm track (one lat/lon per day, 16–21 May) running from the southern Bay of Bengal up toward the Bangladesh/West Bengal coast — approximate Amphan's real path, doesn't need to be survey-accurate.
- A lifecycle label per day: *Forming → Forming → Intensifying → Peak → Weakening → Dissipated* (6 days, adjust wording distribution as needed).
- A per-day "ocean heat content" / fuel number that rises then falls as the storm passes a given point (simple hand-authored curve, e.g. `[78, 82, 88, 91, 74, 61]`).
- A per-day rapid-intensification risk percentage, again hand-authored to peak around day 3–4.

**Required UI:**
- A day-by-day timeline scrubber (1–6) with the lifecycle stage labeled at the current position, matching the visual language of the existing depth/knife sliders.
- The cyclone's position rendered as an animated icon/marker in the 3D scene, moving smoothly between days as the scrubber moves (don't teleport — interpolate).
- A **fuel gauge**: a dial or bar UI showing the current day's ocean-heat-content number, visually tied to the 26°C contour already computed in the temperature shader (the existing `uHi` contour line) — make that contour visually glow warmer/brighter as fuel increases.
- A **wake effect**: as the day advances past a point on the track, the temperature field along the wake should visibly cool behind the storm (fake this by locally subtracting a "days since storm passed" falloff from the existing temperature volume near the track — a shader-side or CPU-side adjustment, doesn't need to be physically simulated, just needs to look like churn-and-recovery).
- An RI-risk readout (e.g. "72% risk of rapid intensification in next 24h") that updates with the day slider.
- Play/pause auto-advance through the 6 days, similar to the existing "Dive" button pattern.

**Nice-to-have if time allows:** a "predict, then reveal" interaction — before pressing play, ask the user to click where they think the ocean will cool most; after the replay, show the actual coolest spot and how close they were.

**Acceptance criteria:**
- [ ] Scrubbing through all 6 days smoothly animates the storm marker, the fuel gauge, the RI-risk number, and the wake cooling — nothing jumps discontinuously.
- [ ] The lifecycle stepper label is always in sync with the scrubber position.
- [ ] Auto-play works and can be paused mid-way without glitching.

---

## 7. View 4 — Search & Rescue Drift Predictor

**Concept:** drop a pin for a last-known position, pick how long ago, and watch a particle cloud spread with the currents to show where to search now.

**What to simulate:** reuse the existing surface-current field and particle-advection logic already in `ocean-cake.html` (`surfaceVel`, the current-streamline particle system). On pin-drop:
1. Spawn 300–800 particles at the pin's location with small random jitter.
2. Advect them forward through the existing current field for the selected duration (offer presets: 2h / 6h / 12h / 24h), speeding through the simulation visually over 2–4 seconds rather than instantly snapping to the end state — the user should see the cloud spread, not just appear.
3. Settle into a final cloud. Compute a simple density grid over the final particle positions.

**Required UI:**
- Click-to-drop-pin interaction directly on the 3D ocean surface.
- A time-ago selector (chips, matching existing chip style).
- The animated spreading particle cloud, rendered as glowing points whose opacity/density visually communicates probability.
- A ranked list panel: "Priority search boxes," each with a rough bearing and distance from the last-known position and a priority number (1 = search first), derived directly from your density grid — highest-density cells first.
- A compass-style bearing indicator showing overall drift direction.

**Acceptance criteria:**
- [ ] Dropping a pin anywhere in open water (not on land) starts a visible spreading animation, not an instant jump.
- [ ] Changing the time-ago selector after a drop re-runs the simulation with a visibly different (longer/shorter) spread.
- [ ] The ranked search-box list updates to match the simulation and is sorted correctly.

---

## 8. View 5 — Sonar

**Concept:** port `sonar-quiet-zone.html` in as a first-class view, reskinned to match the shared design system, plus one integration upgrade.

**Required polish:** rebuild its layout using the shared component set (card, chip, segmented control) rather than its current standalone styling — same visual family as every other view now.

**New integration:** add a "place sonar here" mode — clicking any point in the Ocean Slicer's 3D cake should be able to jump to the Sonar view with that location's temperature/salinity profile pre-loaded into the ray tracer (sample the same procedural functions already used for the cake, e.g. `tempFn`/`salFn`, at the clicked lon/lat). Keep the existing three canned presets (calm sea / after a cyclone / submarine below the layer) as quick-access chips alongside this.

**Nice-to-have tie-in:** when Cyclone Lab's day slider is at "Peak" or later, show a small linked stat somewhere near the sonar entry point — e.g. "Quiet zone has shifted ~1.2 km and deepened since the storm" — a simple canned value keyed off the current cyclone-lab day, not a live recomputation.

**Acceptance criteria:**
- [ ] The sonar view visually matches the rest of the app (fonts, cards, chip style) rather than looking like a separate tool bolted on.
- [ ] Clicking a point in the Ocean Slicer and choosing "place sonar here" correctly lands on the Sonar view with a profile that's plausibly different depending on where you clicked (warmer/fresher near the Bay of Bengal vs. saltier in the Arabian Sea, consistent with the existing procedural ocean).

---

## 9. View 6 — Learn

**Concept:** the public-facing, gamified mode — a guided cyclone story, a marine-life layer, and quizzes.

### 9.1 Story Mode
A scripted camera tour reusing Cyclone Lab's data: fly in over the Bay of Bengal → show the calm baseline (day 1) → auto-advance through the days → the fuel gauge and wake effect play out automatically → camera settles near an Argo float that "caught" the event → its profile panel opens automatically → a closing caption ties it back to real-world impact (hazard warnings, fisheries, search-and-rescue). Auto-narrated via on-screen caption text advancing in sync with the camera, not audio (unless you want to add optional audio narration — not required).

Include 2–3 "predict, then reveal" quiz beats woven into the tour itself (e.g. paused at the right moment: "Which color do you think will light up next?" with 2–3 tappable options, then it plays out and confirms).

### 9.2 Marine life map
A toggle-able layer on the cake (or a dedicated simplified scene) showing ~12–15 hardcoded species placed at plausible depths, grouped into three bands with labels: **Sunlit (0–200m)**, **Twilight (200–1000m)**, **Midnight (below 1000m)**. Each species: name, one-line fact, simple depth-appropriate icon or silhouette shape. Include one deliberate empty/dim band in the Arabian Sea between roughly 150–1000m labeled as a low-oxygen zone, with a short explanatory callout on tap — this is the single most memorable teaching moment in this view, don't skip it.

### 9.3 Quiz mode
A standalone set of 5 multiple-choice questions tied to concepts shown elsewhere in the app (reading a colorbar, what an anomaly layer means, what the fuel gauge shows, etc.), presented as flip-style or one-at-a-time cards matching the shared design system, with a score at the end and a short explanation per answer.

**Acceptance criteria:**
- [ ] Story Mode plays start-to-finish unattended once started, and can be paused/resumed.
- [ ] The marine life bands are clearly separated visually and the low-oxygen callout is genuinely legible and distinct, not a throwaway label.
- [ ] The quiz tracks score correctly across all 5 questions and shows a clear end state.

---

## 10. AI Copilot

**Concept:** a floating command bar (collapsed pill in a corner, expands into a chat-style panel) that lets the user type a request in plain English and watches the app actually respond — not just print text back.

**Important: do not wire this up to a real LLM API.** Build a small **keyword/pattern-matching command router** against the shared app-state store from section 3. This is expected and correct for this prototype — the goal is that it *feels* intelligent, not that it *is* a general-purpose model. Suggested pattern set (extend freely, but this is the minimum bar):

| User types something containing... | Copilot should... |
|---|---|
| a variable name ("temperature", "salinity", "currents") + optionally a depth number | switch the Ocean Slicer's variable and/or depth accordingly, and confirm in the response bubble what it changed |
| "amphan" or "cyclone" | switch to Cyclone Lab and jump to a relevant day |
| "float" + a number, or "argo" | select the matching (or nearest) float and open its profile panel |
| "quiet zone" or "sonar" | switch to the Sonar view |
| "deploy" or "recommend" or "next float" | show a canned ranked list of 2–3 recommended deployment coordinates with a one-line "why" each (e.g. "high model disagreement, no coverage within 200km") — pull the coordinates from the Truth Meter's synthetic disagreement field so it's at least internally consistent |
| "search" or "rescue" or "drift" | switch to Search & Rescue view |
| anything unmatched | a graceful fallback response that still feels in-character, not a raw error |

**Required UI polish:**
- The response should read like a short, real bulletin (a sentence or two, filled in with the current app-state values it just changed), not a debug log.
- A visible "typing"/thinking micro-animation before the response appears, even though it's instant under the hood — this sells the illusion of intelligence and should be brief (a few hundred ms), never a fake multi-second delay.
- The panel should show a short scrollback of the last few exchanges, not just the latest.

**Acceptance criteria:**
- [ ] At least one working example from every row in the table above, demonstrated by actually changing the visible app state, not just replying in text.
- [ ] The copilot is reachable and usable from every one of the 6 views without losing your place in that view.

---

## 11. Explicit non-goals

- No real backend, API, database, or file upload.
- No real LLM call for the copilot — pattern matching only.
- No real GLORYS/Argo/NetCDF data — everything is procedural or hand-authored, exactly as `ocean-cake.html` already does it.
- No user accounts, persistence across page reloads, or multi-user anything.
- No need for automated tests — this is a visual/interaction deliverable, verify by eye against the acceptance criteria in each section.

---

## 12. Suggested build order

Build the shell before any feature, and keep every feature demo-able in isolation as you go — don't leave the app in a broken state between phases.

1. **App shell** — navigation, shared Three.js canvas, shared state store, design tokens extracted from `ocean-cake.html`.
2. **Ocean Slicer** — port and polish (section 4). This sets the quality bar for everything after it.
3. **Truth Meter** — extends the Ocean Slicer's data and mechanism the least new surface area for the second-most impact.
4. **Cyclone Lab** — the biggest new piece; build the timeline/fuel-gauge/wake mechanics before worrying about polish, then polish.
5. **Sonar** — port + the "place sonar here" integration; lower risk since a working standalone version already exists.
6. **Search & Rescue** — new particle-sim logic, but reuses the existing current field.
7. **Learn** — built last among the 6 since it deliberately reuses Cyclone Lab's data for Story Mode.
8. **AI Copilot** — built last of all, since it needs every other view's state shape to already be settled.
9. **Final pass** — responsive check on a narrow viewport for all 7 views, motion/easing consistency check, loading/empty-state check, one full click-through of every acceptance-criteria checkbox above.

---

## 13. Definition of done

The prototype is done when someone can open it cold, with no explanation, and:
1. Move fluidly between all 7 views without any visual hitch, reload, or dead end.
2. Interact with every control listed in every "Required UI" subsection above and see an immediate, smooth, correct response.
3. Type at least three different kinds of requests into the copilot and watch it actually drive the app.
4. See it work on both a laptop-width and a phone-width screen.
5. Never see a console error, a placeholder "TODO," or obviously fake-looking static data (i.e., numbers should look like they came from somewhere, not `123` or `Lorem ipsum`).
