# case_00001: computed nephrometry and volumes

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-29T21:06:37.117673+00:00 by renalplan 0.2.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 2.6 cm | 1 |
| E: exophytic fraction | 0% outside the parenchymal outline (5% or less counts as entirely endophytic) | 3 |
| N: nearness to sinus / collecting system | 1.1 mm | 3 |
| A: anterior / posterior | a | - |
| L: polar location | entirely between the polar lines | 3 |
| Hilar | no / not assessed | - |
| **Total** | **10a** | high complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle (more than half of the tumour between the polar lines) | 2 |
| Exophytic rate | see above | 3 |
| Renal rim | medial | 2 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 2.6 cm | 1 |
| **Total** | **10** | high |

Assumptions: 1 additional tumour component(s) present; scores refer to the largest (index) lesion. Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour. Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines differently. PADUA's polar item is middle (2) when more than half the tumour lies between the lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item are approximations.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 2.9 ml |
| Ipsilateral kidney volume | 222 ml |
| Contralateral kidney volume | 226 ml |
| Ipsilateral share of total renal volume | 50% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 9.8 ml |
| Parenchyma inside the margin | 7.0 ml |
| Residual ipsilateral parenchyma | 215 ml (97% preserved) |
| Tumour-parenchyma contact surface | 20.9 cm2 |
| Tumour to sinus | 1.1 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
