# Surface rendering and collecting-system case

10 October 2026. Repository: nityjr-ctrl/calyxview-renal.

The five legacy GLBs lacked normals. Some kidney meshes also had inward triangle winding (negative signed volume). The viewer now supplies normals, corrects winding without moving vertices, and draws front faces to avoid transparent back-face overlap.

Kidney envelopes receive 10 Taubin pairs (0.5 / -0.53), bounded to 1 mm from each original vertex. Connectivity is unchanged. The corresponding triangle surfaces remain within that displacement bound by barycentric interpolation. This is display smoothing against the existing source-outline surface, not a new segmentation. Tumours, cysts and collecting-system geometry are not smoothed. Original GLBs, masks and scores are unchanged. Automated measurements of absolute volume change were 0.1860%, 0.2788%, 0.1522%, 0.1218%, 0.1005% for A–E and 0.0206% for the CT urogram. Residual slice steps are retained rather than inventing a smoother anatomical contour.

## CT urogram provenance

The separate urogram is from the public TCIA TCGA-BLCA excretory series previously processed in the CalyxView research project. It is not added to the KiTS cases. Dataset: TCGA Research Network, DOI 10.7937/K9/TCIA.2016.8LNG8XDR, CC BY 3.0.

The generator verifies the original volume SHA-1 and the clean 1 mm working-volume SHA-256 before publishing. Four independently resampled source points agree with the working volume to 0 HU. This is an identity/sampling check, not a comprehensive segmentation accuracy study. Only cropped, windowed WebP slices, contour coordinates and GLB surfaces are published; raw volumes and source headers stay outside Git.

The collecting-system mask is the existing contrast-supported automatic candidate: 350–1800 HU, 26-connectivity, seeded from the left kidney, excluding bladder/aorta/IVC. Its source report states no morphological closing, artificial bridging or inferred unopacified anatomy. The kidney mask is automatic. Both require expert review. The 1 mm resampling can omit fine structures; this is a partial visible-lumen reconstruction, not a complete calyceal tree or ureter wall. No synthetic stone, edited CT, teaching lumen thickening or scenario assets are used.

`scripts/make-urogram.py` exports masks without surface smoothing and includes outward normals. The viewer applies only the bounded kidney-envelope display smoothing described above. `docs/urogram-build-evidence.json` records mask hashes, voxel counts, mesh volumes and generation checks. Sixty-five axial samples at 2 mm spacing share the model's RAS coordinates. Window: level 250, width 1000 HU. The inherited `tumourSlice` field is only the CT-panel focus index for compatibility; this case has no tumour label or tumour scores.

## Verification

Acceptance: corrected normals and winding; bounded kidney smoothing with under 1% volume change; independently sourced collecting-system case with source overlays and explicit limitations; desktop/mobile controls and accessibility; production bundle contains no raw scan or sensitive headers.

Tests cover all six GLBs, finite unit normals, preserved positions during normal/winding repair, unchanged triangle membership, outward signed volume, smoothing displacement and volume bounds, CT ordering and contours. Browser checks cover five widths (320–1440 px), source images, layers, CT scrolling, outlines, views, zoom/reset, route entry/return and WCAG A/AA. Visual inspection confirmed the inward-face rendering defect is corrected. The remaining collecting-system irregularity reflects the source candidate and is not represented as expert-validated anatomy.

Local QA artifacts: sibling archive/surface-20261010. Related CalyxView source worktree: pcnl-guided-access at b0329ff, branch feat/pcnl-simulated-ultrasound, consulted read-only. Its published anatomy was not modified.
