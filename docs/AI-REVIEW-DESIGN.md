# Local AI review design

10 October 2026. Reading this as a local renal anatomy review tool for research
users, in CalyxView's warm clinical editorial language. ENERGY 2 / RHYTHM 3 /
MOTION 1, following [the accepted site direction](../DESIGN.md).

The source CT and the draft model are the main working surfaces. The table
below answers which masks exist and who has reviewed them. The final section
provides the method, input hash and downloads. On a phone, the model and CT
follow each other in reading order. This variation serves different tasks.

Design reasons:

- Warm paper and dark ink carry the main site's reading surface into local review.
- Georgia headings retain the medical-atlas voice; Segoe UI keeps controls readable without font downloads.
- The paired viewing surfaces support comparison of the reconstruction against the CT.
- Dark image fields provide a stable background for greyscale CT and anatomical colour data.
- Rust identifies links and focus. Kidney, tumour, artery, vein and lumen colours encode mask identity and are outside the editorial palette limit.
- Fine rules and generous spacing separate work, inventory and provenance without decorative cards.
- Buttons have 3 px corners to distinguish them from square data surfaces.
- Coloured squares identify actual model layers; labels remain readable without colour recognition.
- Rendering responds to direct controls and canvas resizing. Nothing rotates or pulses on its own.
- Loading controls remain disabled until data are available. Errors name the failed resource and a recovery action.
- Quiet copy explains the research limit, input, result and correction process. No clinical readiness or security certification is implied.

## Item-by-item delivery gate

Scope: the local review interface and the added public workflow explanation.
All results below are PASS. Hard/Purpose/Craft questions have a negative answer;
Liveliness/UI/Copy requirements have a positive answer. Evidence comes from the
actual two public research bundles, six viewport runs, five state checks and
the source/build checks described in [the verification record](AI-SEGMENTATION-VERIFICATION.md).
Clinical model qualification is a separate, explicitly incomplete outcome.

### Core hard gate

| Item | Result | Evidence |
| --- | --- | --- |
| R-02, em dashes | PASS | New interface and site copy contain none; frontend copy tests pass. |
| R-03, mobile overflow | PASS | 320/390 px checks report no overflow; mobile table uses labelled rows. |
| R-17, unsourced statistics | PASS | Volumes come from mask voxel counts and CT spacing; no adoption/performance statistics appear in the interface. |
| R-18, fictional testimonials | PASS | No testimonials, avatars or invented users. |
| R-23, unauthorised assets/navigation | PASS | Full editorial rights and Renal-tab instruction cover the work; models are actual measured research output, explicitly drafts. |
| R-24, ghost navigation | PASS | All eight local downloads return 200; the public source link targets the release branch. |
| R-25, contrast | PASS | Six WCAG A/AA browser scans report zero violations; rust links and ink/paper reading surfaces remain legible. |
| R-26, dead controls | PASS | Four cameras, all layer controls, three planes and slider change the view; unavailable controls stay disabled. |
| R-27, missing states | PASS | Empty collecting mask names the reason; loading, GLB failure, manifest failure and image failure have checked states/actions. |
| R-28, generic FAQ | PASS | No FAQ added; explanations address CT, model provenance and correction. |
| R-32, keyboard/focus | PASS | Native controls accept keyboard input; Tab reaches links with a solid rust outline. |
| R-33, external feature patches | PASS | Features live in versioned Python/HTML/JS/TSX source; bundle exports derive from that source. |
| R-34, broken alternate theme | PASS | The interface has one declared paper theme; dark areas display image data. No theme toggle exists. |
| R-35, unrun app | PASS | Two completed CT inference bundles render; recorded click-through covers every available control and download. |
| R-36, fabricated claims | PASS | Copy states unqualified vessels, unassessed lumen and lack of clinical validation; no security or accuracy promise. |
| R-37, absent direction | PASS | Design Read and ENERGY 2 / RHYTHM 3 / MOTION 1 precede implementation and follow accepted DESIGN.md. |
| R-38, plausible invented content | PASS | Only actual masks/statuses/hashes appear; browser-only phase fixture is explicitly identified as a fixture. |

### Core purpose gate

| Item | Result | Evidence/reason |
| --- | --- | --- |
| R-01, default gradient/glow | PASS | Flat paper and dark CT fields; neither effect is used. |
| R-04, generic icons | PASS | No decorative icon set; labelled colour squares identify mask layers. |
| R-06, typography | PASS | Georgia carries the atlas voice; Segoe UI supports readable native controls. No oversized monospace or tracked uppercase. |
| R-07, background grid | PASS | No decorative pattern; the workspace grid pairs two related data views. |
| R-08, arrows | PASS | No decorative CTA arrows. |
| R-09, badges | PASS | No capsule or redundant pill above the title. |
| R-10, glass | PASS | No glass or blurred surfaces. |
| R-12, shadows | PASS | No component shadow system. |
| R-13, distributed glow | PASS | No glow. |
| R-14, repeated cards | PASS | Viewer pair, mask inventory and reading section have different structures for different tasks. |
| R-19, template motion | PASS | Rendering responds to explicit camera/layer/resize actions; no idle rotation or animation. |
| R-22, generic illustration | PASS | The only imagery is the actual CT and unsmoothed measured mask meshes. |

### Core liveliness

| Requirement | Result | Evidence |
| --- | --- | --- |
| Explicit dials | PASS | ENERGY 2 / RHYTHM 3 / MOTION 1 in the Design Read. |
| Dials match result | PASS | Calm paper voice, varied workspace/table/provenance rhythm and direct-action rendering. |
| Focal point | PASS | CT/model dominate the working view; inventory and method headings guide lower screens. |
| Structural whitespace | PASS | 28 px paired-view gutter and section rules separate review from inventory and provenance. |
| Deliberate accent | PASS | Rust marks links, focus and control selection; anatomical colours encode data separately. |
| Identity motif | PASS | Georgia atlas headings, paper field and fine ink rules recur in the main site and local view. |
| Prior Design Read | PASS | Recorded before interface generation, retained at the top of this document. |

### Core craftsmanship and quality locks

| Item | Result | Evidence |
| --- | --- | --- |
| C-1, intentionality | PASS | Every major visual choice has a reason in the design-reasons list. |
| C-2, complete interactions | PASS | Browser camera/layer hashes change; planes/sliders, phase fixture and downloads work. |
| C-3, content-driven composition | PASS | Source review, mask inventory and provenance each serve a concrete research decision. |
| C-4, resilience | PASS | Six mobile/desktop runs plus loading and resource-failure checks; native keyboard controls. |
| C-5, evidence | PASS | Actual CT/mask data and pending decisions; no fabricated claim or testimonial. |
| R-05, template rhythm | PASS | Paired data surfaces, row inventory and prose/downloads; no hero/cards/pricing template. |
| R-11, pill shapes | PASS | Square data surfaces and 3 px button corners; no pill treatment. |
| R-15, generic CTA | PASS | Actions name the downloaded model, provenance, source CT or setup instructions. |
| R-16, buzzwords | PASS | Copy describes models, CT phases and corrections without marketing language. |
| R-20, generic identity | PASS | Atlas typography and actual renal CT review define the screen's specific purpose. |
| R-21, forced dark theme | PASS | Paper is the reading theme; dark CT/model fields keep image backgrounds consistent. |
| R-29, palette | PASS | Paper, ink, rules and rust follow DESIGN.md; separately labelled mask colours are the data palette. |
| R-30, product clone | PASS | No borrowed dashboard/marketing composition; screenshots show a clinical atlas workspace. |
| R-31, explainable decisions | PASS | Colour, layout, type, spacing, square surfaces and real images each have a one-line reason above. |

### UI supplement

| Requirement | Result | Evidence |
| --- | --- | --- |
| Written palette | PASS | Accepted DESIGN.md and explicit paper/ink/rust reasons. |
| Accent at key moments | PASS | Links/focus/selection use rust; reading and data fields stay neutral. |
| No decorative emoji | PASS | None in source interface or added site copy. |
| Varied compositions | PASS | Pair, mobile stack, labelled inventory and method reading area. |
| No default AI shapes | PASS | No bento, fake terminal, pricing columns or colour stripes. |
| Clear area above H1 | PASS | Plain CalyxView context line; no redundant pill. |
| Real navigation/interactions | PASS | Download status checks and recorded control click-through. |
| Purposeful motion | PASS | Direct manipulation only; no endless loops. |
| Effect dose caps | PASS | No glass/glow/shadows; 3 px controls and square fields. |
| Meaningful colour indicators | PASS | Layer swatches map actual kidney/tumour/artery/vein masks; no decorative state lights. |
| Decision-centred app | PASS | Compare draft anatomy with source CT, then inspect review status and download a mask. |
| Real numbers and rows | PASS | Exported voxel counts/spacing calculate volumes; all initial review states are pending/unassessed. |
| Honest empty fields | PASS | Empty masks show zero and a cause, with no fabricated reviewer. |
| Cause/action in states | PASS | Missing files name local bundle/reload/Slicer actions; insufficient contrast stays unassessed. |
| Breakpoint/state/keyboard resilience | PASS | Six viewport scans, five state checks and solid keyboard focus. |

### Copywriting supplement

| Requirement | Result | Evidence |
| --- | --- | --- |
| No fabricated specifics | PASS | Model names, hashes and limits derive from verified source/runtime; volumes are computed. |
| Specific language | PASS | The copy names CT, masks, phases and source review; no empty AI vocabulary. |
| No em dashes | PASS | Interface/site source scan and frontend copy tests. |
| No excessive quotes | PASS | Quotes only identify the actual Not detected state. |
| No all-caps emphasis | PASS | CT, HU and RAS are technical abbreviations, not emphasis clauses. |
| Concrete actors | PASS | New public copy names the workflow, models and reviewer; local controls address the reader directly. |
| Specific CTAs | PASS | Download the draft 3D model / provenance record / source CT; Read the local AI setup and limits. |
| Varied natural rhythm | PASS | Method explanation, short caveats and direct review instructions, without forced triples or aphorisms. |
| Chosen voice | PASS | Calm research atlas voice with explicit uncertainty and practical correction instructions. |
| Read-aloud review | PASS | Copy was reviewed for padding and unclear claims; the failed collecting result is stated plainly. |
