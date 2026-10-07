# case_00005: computed nephrometry and volumes

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-29T21:07:10.128084+00:00 by renalplan 0.2.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 6.2 cm | 2 |
| E: exophytic fraction | 17% outside the parenchymal outline (5% or less counts as entirely endophytic) | 2 |
| N: nearness to sinus / collecting system | 0.5 mm | 3 |
| A: anterior / posterior | a | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **9a** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | superior (half or less of the tumour between the polar lines) | 1 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | yes | 2 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 6.2 cm | 2 |
| **Total** | **9** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour. Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines differently. PADUA's polar item is middle (2) when more than half the tumour lies between the lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item are approximations. Sinus estimate implausibly large (62% of the kidney's volume, spanning 61% of its length): the kidney isn't the usual shape, as with a horseshoe or malrotated kidney. The long axis, polar lines and sinus all rest on that shape, so L, N and PADUA's polar, rim and renal-sinus items are unreliable for this kidney.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 64.4 ml |
| Ipsilateral kidney volume | 395 ml |
| Contralateral kidney volume | 0 ml |
| Ipsilateral share of total renal volume | 100% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 82.3 ml |
| Parenchyma inside the margin | 17.9 ml |
| Residual ipsilateral parenchyma | 377 ml (95% preserved) |
| Tumour-parenchyma contact surface | 68.3 cm2 |
| Tumour to sinus | 0.5 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
