# case_00007: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:14:52.550417+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 3.9 cm | 1 |
| E: exophytic fraction | 52% outside the parenchymal outline | 1 |
| N: nearness to sinus / collecting system | 26.3 mm | 1 |
| A: anterior / posterior | a | - |
| L: polar location | crosses a polar line | 2 |
| Hilar | no / not assessed | - |
| **Total** | **5a** | low complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle | 2 |
| Exophytic rate | see above | 1 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 3.9 cm | 1 |
| **Total** | **7** | low |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 19.2 ml |
| Ipsilateral kidney volume | 250 ml |
| Contralateral kidney volume | 282 ml |
| Ipsilateral share of total renal volume | 47% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 27.2 ml |
| Parenchyma inside the margin | 7.9 ml |
| Residual ipsilateral parenchyma | 242 ml (97% preserved) |
| Tumour-parenchyma contact surface | 21.0 cm2 |
| Tumour to sinus | 26.3 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
