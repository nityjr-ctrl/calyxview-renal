# case_00005: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:14:37.546801+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 6.2 cm | 2 |
| E: exophytic fraction | 17% outside the parenchymal outline | 2 |
| N: nearness to sinus / collecting system | 0.5 mm | 3 |
| A: anterior / posterior | a | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **9a** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle | 2 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | yes | 2 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 6.2 cm | 2 |
| **Total** | **10** | high |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

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
