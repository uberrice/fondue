# Fondue Gerber viewer

Open **gerber-viewer.html** in a current desktop browser, then drop a Gerber ZIP onto the window or click **Open ZIP**. The HTML is the complete application. You can copy it anywhere and use it offline without installing anything.

The included `GERBER-ETBoy.zip` loads nine Gerber layers and two drill layers. The two drill-map PDFs are skipped and listed in the loading report.

## Controls

- Select a layer name to bring it to the front. Previous/Next or `[` and `]` step through visible layers in sidebar order. Solo selected toggles a single-layer view; Previous/Next then cycles through all layers in enabled groups. Turning Solo selected off restores the individual visibility choices.
- Click Copper, Manufacturing, or Drill to show/hide the whole group without changing its individual layer checkboxes. Layers are grouped into Copper, Manufacturing, and Drill. Top copper is fixed red and bottom copper is fixed blue.
- Use each layer's checkbox, color picker, and opacity slider to adjust the overlay. Top and bottom copper colors are locked. Show all, Hide all, and Solo selected provide quick visibility changes.
- Scroll to zoom around the pointer and drag to pan. `F` fits the board.
- Click Measure or press `M`, then click two points. Each measurement shows distance and signed X/Y differences in both mm and mil. One mil is 0.0254 mm.
- Middle-drag or Space-drag pans while measuring. Escape cancels the pending measurement. Clear measurements removes all measurements.

Every layer starts at 100% opacity. All opacity sets every layer to the chosen percentage, replacing individual opacity values. You can adjust individual layers afterward; the all-layer readout shows Mixed when they differ.

All copper, silkscreen, outline, and drill layers appear initially. Solder mask and paste layers start hidden. Negative mask layers show mask material with transparent openings, using the board outline when available. Layers retain their original coordinates; bottom layers are not mirrored automatically.

## File support and limits

The parser supports common RS-274X and X2 Gerbers, millimetre/inch units, coordinate formats, linear and circular interpolation, filled regions, standard apertures, macro primitives 1/2/4/5/6/7/20/21/22, aperture transformations, layer polarity, and step-repeat. It identifies layers using X2 attributes and filename fallbacks.

Excellon support includes drill hits, linear routed slots, and G85 slots. Drill arcs and repeat commands are rejected with a message. Swept macro/polygon apertures and curved non-circular aperture strokes use circular approximations and produce warnings. Unknown Gerber commands are reported; an unsupported aperture primitive rejects that layer. A loading report can therefore indicate incomplete geometry. This is a viewing tool, not a manufacturing validation tool.

The viewer accepts stored or Deflate ZIP entries and uses the browser's built-in `DecompressionStream`. Use a current browser with `deflate-raw` support. Encrypted, split, and ZIP64 archives are unsupported. Limits are 64 MB per input/archive entry, 256 MB expanded, and 1,000 entries. Files stay in memory and are never uploaded.

## Development

The viewer has no runtime or build dependencies. Source files are in `src/`.

```sh
node scripts/build.mjs
```

This rebuilds the standalone HTML and the `dist/` site from the source. The generated site directory is ignored by Git. Tests use Node.js 22+ and the development-only `@napi-rs/canvas` package, or the installed Codex canvas runtime.

```sh
npm install --no-save @napi-rs/canvas
npm test
```

Tests exercise ZIP decoding, the supplied board, geometry/polarity, layer controls, pointer-based measurements and transforms. They write canvas previews into `tests/artifacts/` for visual inspection. They run with a minimal DOM adapter, not a full browser. Full browser interaction and cross-browser compatibility still require manual verification; the development sandbox blocked Chromium from launching.

## Rendering performance

At lower zoom levels the viewer caches the entire board, so panning does not redraw geometry. At higher zoom levels it caches the visible area with an extra margin. Cache refreshes run in short tasks while a complete-board preview fills newly exposed areas. Compatible strokes are batched, offscreen drawing operations are skipped, and aperture images are reused within a memory budget.

Opacity, ordering, and visibility changes reuse cached layer images. During wheel zoom, the cached image scales immediately; detail refresh starts 120 ms after the last wheel event. Measurements use the current board coordinates throughout navigation.

Run the repeatable 40-frame pan benchmark with the supplied ZIP:

```sh
node tests/viewer.mjs --benchmark
node tests/viewer.mjs --benchmark-long
```

The longer benchmark pans across cache boundaries at 4× zoom, allowing background work to run between frames. Both report frame times and geometry repaint counts using the native canvas test runtime. These measurements do not include a browser's layout or GPU work.
