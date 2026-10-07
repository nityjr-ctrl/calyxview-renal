# case_00006: computed nephrometry and volumes

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-29T21:07:13.367546+00:00 by renalplan 0.2.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 3.6 cm | 1 |
| E: exophytic fraction | 0.1% outside the parenchymal outline (5% or less counts as entirely endophytic) | 3 |
| N: nearness to sinus / collecting system | 0.7 mm | 3 |
| A: anterior / posterior | a | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **9a** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | superior (half or less of the tumour between the polar lines) | 1 |
| Exophytic rate | see above | 3 |
| Renal rim | medial | 2 |
| Renal sinus involvement | yes | 2 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 3.6 cm | 1 |
| **Total** | **10** | high |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour. Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines differently. PADUA's polar item is middle (2) when more than half the tumour lies between the lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item are approximations.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 11.3 ml |
| Ipsilateral kidney volume | 177 ml |
| Contralateral kidney volume | 208 ml |
| Ipsilateral share of total renal volume | 46% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 20.5 ml |
| Parenchyma inside the margin | 9.2 ml |
| Residual ipsilateral parenchyma | 168 ml (95% preserved) |
| Tumour-parenchyma contact surface | 34.7 cm2 |
| Tumour to sinus | 0.7 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
