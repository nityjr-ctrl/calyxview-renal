# Full editorial rebuild: review and delivery gate

10 October 2026. Requested by Nity with full editorial authority and permission to publish.

The accepted design read is a professional renal research tool with an editorial front end. ENERGY 2 / RHYTHM 3 / MOTION 1. Design reasons and acceptance outcomes are in [DESIGN.md](../DESIGN.md).

## Scope and provenance

Canonical repository: `CalyxView-Renal/repo`, remote `nityjr-ctrl/calyxview-renal`. Work began from production commit `90762e54ef16538edf84579b455bbe7ba0ed2c05` (10 October 2026, 02:55:23 BST), verified on origin/main and the published Netlify deploy. Implementation branch: `design/full-editorial-rebuild`.

The separate company-details worktree and open PR #2 were reviewed for provenance and left untouched. No dependency upgrades, clinical computation changes, raw scans or private datasets are included.

## What changed

- The long overview became Home, Cases, Build a model, Methods & evidence, and About. Evidence has separate scoring/model and segmentation destinations. Legacy links still resolve.
- All editorial pages were rewritten; research and workspace prose was tightened while preserving measurements, denominators, uncertainty, licensing and reproducibility details.
- The case collection compares CT images, computed scores and tumour measurements in rows. Each case has distinct CT and 3D actions.
- The builder guide explains inputs, inspection, exports and file handling. The workspace starts with the file input, with detailed methods in a disclosure and essential limitations always visible.
- Viewer labels describe their function: Volumes, Translucent, Illustrative, Build a model and Case viewer. General surgical-approach notes were removed from volume panels because they did not explain the displayed calculation.
- Warm paper, serif headings, restrained rust accents and fine rules carry across the editorial pages. Workspace controls are larger and measurement labels more legible. Share metadata uses the real Kidney C CT.

## Verification evidence

Evidence is retained outside the repository in the project's `archive/rebuild-20261010` folder. Scripts use isolated Playwright dependencies, not new application dependencies.

- `build.log`: `npm run build:netlify`, including 57 passing tests, lint, TypeScript, production build and sensitive-data bundle scan.
- `local-verification.json`: 152 recorded checks, 21 axe WCAG A/AA scans with zero reported violations, and zero uncaught browser errors.
- Six editorial destinations checked at 320, 390, 768, 1024 and 1440 CSS pixels. CT/model workspace checked at the same widths. Screenshots reviewed for content hierarchy, wrapping and spacing.
- Recorded actions cover navigation, mobile menu, skip link, focus return, five CT/model pairs, all inspector tabs, CT slice/outlines controls, layer toggles, view presets, zoom/reset, image download, opacity/cutaway, dialogs, case switching, builder input/error/sample/clear and GLB/STL/JSON/Markdown downloads.
- `state-checks.json`: ten additional checks cover 320px builder panels, keyboard tabs, margin/opacity, mode switching, unknown-case recovery, history, reduced-motion editorial pages, unavailable WebGL, failed viewer chunks and failed CT loading.
- `links.json`: ten public source URLs returned HTTP 200. Zenodo's existing published-model URL returned an automated-client 403, so availability through that client is unverified; the source link is preserved. Email links were inspected without sending mail.
- These are Chromium browser checks and emulated viewports, not physical-device testing or a guarantee of complete WCAG conformance. Clinical validation is outside this design task.

## Antislop delivery gate

### Hard gate

- R-02 PASS: source-copy tests reject en/em dashes across the edited pages and viewer.
- R-03 PASS: all recorded viewport checks report no document overflow; phone screenshots show wrapped case rows and contained tables.
- R-17 PASS: case values come from referenceCases; evidence values come from validated result objects. No invented adoption or performance statistics.
- R-18 PASS: no testimonials, customer avatars or endorsements.
- R-23 PASS: navigation redesign is authorised by the full-site editorial brief; images are existing attributed KiTS23 assets.
- R-24 PASS: four main destinations, evidence subnavigation, contents links and legacy fragments were exercised.
- R-25 PASS: 21 axe scans report no contrast violations; paper, ink, muted text and action colours were visually reviewed.
- R-26 PASS: buttons have working handlers; source/email links have explicit destinations; recorded controls change state, navigate or download.
- R-27 PASS: builder empty/loading/error/result states, CT loading/error and failed viewer/WebGL states have feedback and recovery.
- R-28 PASS: no filler FAQ.
- R-32 PASS: skip link, focus restoration, menu Escape, arrow-key tabs, sliders and dialogs were exercised; focus outlines are explicit in CSS.
- R-33 PASS: source and CSS were written through direct patches; oxfmt only formatted source. QA scripts do not rewrite the interface.
- R-34 PASS: no theme toggle. Paper pages and the intentionally dark instrument workspace were tested separately.
- R-35 PASS: production build and recorded click-through completed; controls, exports, routes and error states are covered by the evidence above.
- R-36 PASS: no invented compliance claims; unvalidated status and absent regulatory clearance remain explicit.
- R-37 PASS: design read and dials were declared before implementation and recorded in DESIGN.md.
- R-38 PASS: source data, author and study requirements are grounded in the existing project; proposed work is identified as proposed.

### Purpose gate

- R-01 PASS: no decorative gradient or glow; CT shading and 3D lighting represent the source imagery and anatomy.
- R-04 PASS: functional view/layer/export/warning icons remain; redundant icons in research cards are hidden.
- R-06 PASS: Georgia supplies the medical-book character; system sans supports readable controls. Small numeric/code labels serve data inspection.
- R-07 PASS: decorative workspace background grid removed; no editorial background pattern.
- R-08 PASS: editorial CTAs use text. Direction arrows encode metric direction or actual back navigation.
- R-09 PASS: no promotional capsules. Remaining workspace source/safety labels distinguish provenance and intended use.
- R-10 PASS: navigation, workspace tools and dialogs use solid matte surfaces, without stacked glass effects.
- R-12 PASS: no decorative card elevation or large repeated shadows.
- R-13 PASS: no decorative glow.
- R-14 PASS: comparable case rows and evidence metric groups repeat because their data is comparable; other page compositions differ.
- R-19 PASS: no entrance, floating or looping decorative animation. Spinners indicate processing; movement follows user controls.
- R-22 PASS: actual CTs and rendered anatomy replace generic illustrations; no stock blob artwork.

### Liveliness

- Dials PASS: ENERGY 2 / RHYTHM 3 / MOTION 1, recorded in DESIGN.md.
- Consistency PASS: restrained palette and motion; contents rows, case comparisons, builder instructions, evidence tables and author/study layout establish varied rhythm.
- Focal point PASS: each editorial page leads with a clear heading; the workspace centres anatomy or the file input.
- Whitespace PASS: spacing separates title/summary, case records, method groups and footer; reading columns have deliberate widths.
- Accent PASS: rust identifies primary editorial actions and current navigation; anatomical colours remain data.
- Identity PASS: serif headings, CT plates and thin rules recur across the research site.
- Design read PASS: professional renal research tool with an editorial front end, declared before generation.

### Craftsmanship and consistency

- C-1 PASS: major type, palette, layout, motion and imagery choices have written reasons in DESIGN.md.
- C-2 PASS: functional completeness is backed by the recorded control and route checks.
- C-3 PASS: each destination answers a concrete user task; duplicate builder steps and unrelated surgical notes were removed.
- C-4 PASS: tested widths, keyboard paths and failure states remain usable; no theme dependency or mouse-only primary task.
- C-5 PASS: measurements retain their sources and uncertainty; no fabricated social proof.
- R-05 PASS: composition follows clinical content, with no marketing-card, pricing or logo-bar template.
- R-11 PASS: square CT/table surfaces, subtly rounded controls and functional layer markers have distinct roles.
- R-15 PASS: actions name destinations or results, including View the cases, Build the sample and Choose a label map.
- R-16 PASS: no AI marketing buzzwords or claims of effortless clinical accuracy.
- R-20 PASS: real kidney CTs, nephrometry comparisons and instrument controls establish project-specific identity.
- R-21 PASS: light editorial pages; dark workspace retained specifically for CT and translucent anatomy contrast.
- R-29 PASS: paper/ink neutrals with rust accent; anatomical colours are a documented data exception.
- R-30 PASS: composition derives from an annotated clinical atlas, not a copied SaaS interface.
- R-31 PASS: major visual decisions have one-line rationales in DESIGN.md.

Overall design gate: PASS within the documented browser-test scope.
