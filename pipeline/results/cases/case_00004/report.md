# case_00004: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:13:51.569248+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 4.3 cm | 2 |
| E: exophytic fraction | 16% outside the parenchymal outline | 2 |
| N: nearness to sinus / collecting system | 28.2 mm | 1 |
| A: anterior / posterior | x | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **7x** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle | 2 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 4.3 cm | 2 |
| **Total** | **9** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

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
