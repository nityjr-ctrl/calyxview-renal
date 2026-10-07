# case_00004: computed nephrometry and volumes

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-29T21:06:56.374095+00:00 by renalplan 0.2.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 4.3 cm | 2 |
| E: exophytic fraction | 16% outside the parenchymal outline (5% or less counts as entirely endophytic) | 2 |
| N: nearness to sinus / collecting system | 28.2 mm | 1 |
| A: anterior / posterior | x | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **7x** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | inferior (half or less of the tumour between the polar lines) | 1 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 4.3 cm | 2 |
| **Total** | **8** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour. Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines differently. PADUA's polar item is middle (2) when more than half the tumour lies between the lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item are approximations.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 20.2 ml |
| Ipsilateral kidney volume | 232 ml |
| Contralateral kidney volume | 198 ml |
| Ipsilateral share of total renal volume | 54% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 31.4 ml |
| Parenchyma inside the margin | 11.2 ml |
| Residual ipsilateral parenchyma | 220 ml (95% preserved) |
| Tumour-parenchyma contact surface | 35.0 cm2 |
| Tumour to sinus | 28.2 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
