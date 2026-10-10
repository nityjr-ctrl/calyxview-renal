# Renal section on CalyxView

Authorised by Nity on 10 October 2026. The renal app remains in its own repository and can still build for its standalone root. The main site hosts the same source at `/renal/`, with all images, slices, meshes, fonts and worker chunks under that prefix. No iframe or cross-site model request is needed.

Acceptance: main-site entry and return links; KiTS23 explanation with organiser attribution; separate tumour-case and excretory-urogram limitations; modest design explanation; root and `/renal/` assets and model builder working; unchanged imaging, scoring and benchmark results; responsive keyboard access; build, source tests, bundle privacy scan and hosted verification; clean pushed source checkpoints.

Direction continues the warm clinical atlas in DESIGN.md: ENERGY 2 / RHYTHM 3 / MOTION 1. The design explanations belong near the project context. Evidence pages explain dataset scope before presenting scores. No new illustration, anatomical structure, clinical claim or metric is introduced.

Source: https://kits-challenge.org/kits23/ (checked 10 October 2026) describes kidney, tumour and cyst classes and corticomedullary/nephrogenic phases. We use the usual term nephrographic in prose. The absence of a separate collecting-system label does not establish absent anatomy. The existing separate TCIA urogram remains a partial automatic contrast-supported candidate, not a substitute for KiTS anatomy.

## Source verification

64 source tests, lint and TypeScript checks passed. Root and `/renal/` builds passed the sensitive-data bundle scan (354 files). The established browser suite at the integrated prefix passed 152 checks and 21 accessibility scans with zero violations, including the builder worker and downloads. Cross-site integration passed 89 checks and five accessibility scans with zero violations, including all five actual CT/3D pairs and the separate urogram at five widths. A six-check root smoke confirms standalone CT, GLB, urogram and worker paths. No scoring, benchmark, imaging or geometry source was modified.

Evidence lives in `CalyxView/archive/renal-integration-20261010`; the main source's `docs/RENAL-INTEGRATION.md` records the integrated build contract, complete antislop gate and publication evidence. The standalone production deployment is preserved; this change is published as part of the main site's composite release.
