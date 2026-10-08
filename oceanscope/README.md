# OceanScope

Interactive 3D prototype of the North Indian Ocean: one shared Three.js scene, six views and a pattern-matching copilot. Everything is procedural or hand-authored in the browser; there is no backend.

## Run

Open `index.html` directly in a browser (Chrome, Edge, Firefox or Safari with WebGL 2), or serve the folder:

```bash
python3 -m http.server 8765
```

then visit http://127.0.0.1:8765/. Three.js and the Barlow fonts load from CDNs, so an internet connection is needed on first load.

## Layout

- `index.html` – app shell (top bar, nav rail, side panel, 3D stage, copilot)
- `css/app.css` – design tokens and shared components (seg, chip, btn, slider row, rank list, gauge, compass, quiz cards)
- `js/core/util.js` – helpers, tweening, formatting
- `js/core/store.js` – central app state with pub-sub
- `js/core/ocean.js` – synthetic ocean: coastlines, T/S/current/model-error volumes
- `js/core/ui.js` – UI component builders
- `js/core/scene.js` – shared renderer, cake shader, knife, floats, particles, camera, picking, HUD labels
- `js/views/*.js` – Ocean Slicer, Truth Meter, Cyclone Lab, Search & Rescue, Sonar, Learn
- `js/dossier.js` – the dive panel: click any point of the water in the Ocean Slicer to open a full water-column readout
- `js/copilot.js` – keyword router that drives the store and views
- `js/app.js` – navigation and boot

## Ocean Slicer layers

The surface shows water flowing with the current field (a two-phase flow map in the cake shader). Inside a cut you can reveal the 26 °C fuel sheet, the mixed-layer depth, the 20 °C thermocline and the seafloor relief; they render only inside the excavation. Clicking the water dives in: the cake is cut at that point, a probe beam drops down the column, and the dossier shows temperature, salinity, sound speed, current, model error, cyclone fuel, the Truth Meter, sonar quiet zone and marine life for that spot.

## Cinema mode and film mode

Cinema is on by default (toggle in the top bar). It adds a displaced ocean surface with moving waves, wind-streaked foam, surf along the coasts, sun glints and sky reflections; the water colour comes from the data (warm water deep blue, upwelling green, the Ganges plume olive, shoals turquoise). Every cut wall shows the moving waterline, caustics dance in the upper 60 m, bubbles rise along the knife faces, clouds drift with the monsoon and cast shadows, floats bob on the swell with blinking beacons, and Cyclone Amphan becomes a rotating cloud system that raises spiral storm swell. Bloom, colour grading and vignette run as a post-processing pass (three.js r128 examples from jsdelivr); if they fail to load the scene still renders without them. Frame rate is checked after load and the pixel ratio drops to 1 on slower machines.

Clicking the water now plays a short dive: ripple, swoop to the surface with a title card and letterbox, a plunge flash while the column is excavated, then the glass water-column panel.

**Film mode** (the ▶ button, or ask the copilot to "play the film") hides the interface and plays a hands-free, roughly one-minute tour with documentary title cards: establishing shot, Arabian Sea swell, the Great Whirl, the Maldives shoals, the Bay of Bengal, Cyclone Amphan, the cut-open fuel line and the deep. Press Esc to stop. For the final video, make the browser full screen (Ctrl+Cmd+F on a Mac) and screen-record while it plays.

## Copilot phrases that work

"salinity at 300 m", "replay Amphan", "Amphan at peak", "worst float", "float 2902696", "sonar after a cyclone", "search and rescue 12 h", "drop a pin at 12 N, 70 E", "recommend a float", "marine life", "quiz", "story", "whole ocean", "explore mode on", "play the film", "cinema off".
