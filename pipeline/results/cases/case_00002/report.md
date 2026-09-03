# case_00002: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:13:21.231451+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 4.9 cm | 2 |
| E: exophytic fraction | 28% outside the parenchymal outline | 2 |
| N: nearness to sinus / collecting system | 36.1 mm | 1 |
| A: anterior / posterior | p | - |
| L: polar location | crosses the axial renal midline | 3 |
| Hilar | no / not assessed | - |
| **Total** | **8p** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle | 2 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 4.9 cm | 2 |
| **Total** | **9** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 37.0 ml |
| Ipsilateral kidney volume | 246 ml |
| Contralateral kidney volume | 240 ml |
| Ipsilateral share of total renal volume | 51% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 52.6 ml |
| Parenchyma inside the margin | 15.6 ml |
| Residual ipsilateral parenchyma | 230 ml (94% preserved) |
| Tumour-parenchyma contact surface | 54.3 cm2 |
| Tumour to sinus | 36.1 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
