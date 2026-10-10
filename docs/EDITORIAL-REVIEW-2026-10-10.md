# Editorial redesign review

Design: [DESIGN.md](../DESIGN.md). Approved brief: humanise the site, full editorial discretion, and publish. The reading interface now uses warm paper, Georgia headings, concise opening copy and five comparable case rows. The workspace retains its dark anatomy canvas, with matte controls and no decorative grid or glowing dots. Automatic illustration rotation is off. An existing invalid description-list structure in the builder was corrected.

## Verification

- Production build: 57 tests pass, lint and TypeScript pass, deployment bundle privacy scan passes (283 files).
- Chromium production-build review: 100 recorded checks; 11 axe WCAG A/AA scans, zero reported violations; zero uncaught browser errors.
- Twelve additional checks pass: reduced motion, supplementary links/menu controls, phone builder controls, keyboard tabs, no-WebGL fallback and failed workspace-chunk recovery.
- Overview and workspace checked at 320, 390, 768, 1024 and 1440 CSS pixels. Screenshots reviewed for desktop and phone layouts. These are browser emulations, not physical-device tests.
- Clinical computations, reference data, meshes, CT assets and research results are unchanged. This is not clinical validation.
- Detailed local evidence: `C:/NityProjects/CalyxView-Renal/archive/editorial-20261010/`, including `build.log`, `production-build-verification.json`, screenshots and QA scripts. QA dependencies are outside the repository and deploy bundle.

## Recorded interactions

- Main and footer navigation: each of the four links reaches its named section. Footer wordmark returns to the top. Keyboard skip link focuses the main content.
- Five case rows: every 3D button opens the matching case; every CT button opens the matching case with the CT tab selected. All five CT thumbnails load.
- Opening action: opens Kidney C with its CT. Header viewer action opens the viewer; both overview-return buttons work.
- Illustration: all five layer toggles change and restore their state; rotation starts and pauses on request.
- Viewer: all five inspector tabs select their content; all nine Kidney C layer controls toggle; five camera presets select, zoom and reset act, and image export downloads a PNG.
- CT: keyboard changes the slice; tumour shortcut restores the tumour slice; outlines toggle. Ghost sets opacity to 34%; hide-kidney and range controls act.
- Research information: both entry points open the dialog; Escape, Close and OK dismiss it. Research disclosure opens and closes.
- Case switching: A to E change the address and case; the hand-made model opens and its margin changes.
- Builder: empty state, invalid-file error and recovery through sample build work. Four result tabs select; GLB, STL, JSON and Markdown download. Clear restores the empty state. Overview sample and upload actions open their respective builder states.
- Phone menu: opens, closes with Escape and restores focus; section selection closes the menu. Reload retains the chosen workspace case.
- External research and email links retain explicit existing destinations. No email was sent.

## Antislop delivery gate

PASS below describes the inspected UI and tested states, not an assurance about every possible browser or assistive technology.

- R-02 PASS: existing copy regression test finds no prohibited en/em dashes.
- R-03 PASS: document widths fit the five tested viewport widths; screenshots reviewed.
- R-17 PASS: numeric case and benchmark values still come from the unchanged source data.
- R-18 PASS: no testimonials or invented people added.
- R-23 PASS: editorial composition authorised; existing CT imagery and a text wordmark used, no invented visual evidence.
- R-24 PASS: all navigation fragment destinations exist and were exercised.
- R-25 PASS: 11 automated accessibility scans, including contrast checks, report no violations in the inspected states.
- R-26 PASS: recorded navigation, model, CT, builder, download and dialog interactions complete their actions.
- R-27 PASS: builder empty, loading, successful and invalid-file states remain actionable; model/chunk failure messages retained.
- R-28 PASS: no generic FAQ added; the existing research disclosure describes the actual planned protocol.
- R-32 PASS: visible focus styles, skip link, keyboard range controls and Escape dialog/menu behaviour verified.
- R-33 PASS: changes authored directly in TSX and CSS; no source-rewriting script shipped.
- R-34 PASS: no theme toggle; light reading and dark anatomy surfaces both checked.
- R-35 PASS: production build and recorded browser interactions completed; no uncaught browser errors.
- R-36 PASS: no new security, performance, customer or clinical claims.
- R-37 PASS: direction and dials established in DESIGN.md before implementation.
- R-38 PASS: source values retained; synthetic anatomy explicitly labelled.
- R-01 PASS: paper/ink/rust palette documented; decorative viewer gradients and grid removed.
- R-04 PASS: decorative brand, sparkle and wand icons removed; retained workspace symbols identify controls, as documented.
- R-06 PASS: locally available Georgia/Segoe typography has a written reading/control purpose.
- R-07 PASS: no background grid on the reading page, model canvas or builder.
- R-08 PASS: opening arrow signals entry to a workspace; existing proposal arrow signals an external document, not every action.
- R-09 PASS: no pill above the headline; source and research-state labels carry actual information.
- R-10 PASS: header, toolbar, chips and model controls no longer use glass blur.
- R-12 PASS: cards and CT figure sit flat; mobile menu and dialog elevation reflects overlays.
- R-13 PASS: glowing status dots removed from workspace and builder.
- R-14 PASS: case rows compare identical source fields; research panels group measured results by anatomical class. No feature-card sales grid.
- R-19 PASS: default model rotation off, hover feedback only; loading spinners correspond to real work.
- R-22 PASS: only existing CTs and explicitly hand-made anatomical illustration, with provenance.
- Liveliness PASS: ENERGY 2 / RHYTHM 3 / MOTION 1; the opening CT/title, case rows, split builder and tabular research use different compositions.
- Focal point PASS: opening title/CT pair leads; anatomy leads the workspace, with controls at the edges.
- Whitespace PASS: chapter spacing and ruled case rows separate comparison, instructions and research.
- Accent PASS: rust concentrates on the opening and builder actions; case actions use ink.
- Identity PASS: serif titles, specimen captions and chapter numbers establish a repeated clinical-atlas voice.
- Design read PASS: clinical research atlas direction declared before edits.
- C-1 PASS: palette, type, imagery, layout and motion reasons recorded in DESIGN.md.
- C-2 PASS: interactive behaviour recorded above.
- C-3 PASS: sections cover existing cases, builder, illustration, pipeline, benchmark, study and limitations.
- C-4 PASS: tested phone/desktop, keyboard and error states; physical-device testing not claimed.
- C-5 PASS: measurements and provenance come from existing project evidence.
- R-05 PASS: case list, split instructions, model stage, evidence tables and study text have distinct structures.
- R-11 PASS: small control corners, square imagery/tables, no pill treatment throughout.
- R-15 PASS: primary actions name the case, viewer, sample kidney or outline.
- R-16 PASS: no AI marketing slogans introduced.
- R-20 PASS: real renal CTs and clinical-atlas typography carry the identity.
- R-21 PASS: light for reading; dark for grayscale CT/translucent anatomy, with the reason documented.
- R-29 PASS: warm neutral paper/ink plus rust; model colours identify anatomy rather than decorate the page.
- R-30 PASS: no named product interface copied.
- R-31 PASS: major visual decisions have one-line reasons in DESIGN.md.
