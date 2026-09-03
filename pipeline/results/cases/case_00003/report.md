# case_00003: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:13:48.038759+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 3.2 cm | 1 |
| E: exophytic fraction | 2% outside the parenchymal outline | 3 |
| N: nearness to sinus / collecting system | 27.3 mm | 1 |
| A: anterior / posterior | x | - |
| L: polar location | entirely above or below the polar lines | 1 |
| Hilar | no / not assessed | - |
| **Total** | **6x** | low complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | inferior | 1 |
| Exophytic rate | see above | 3 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 3.2 cm | 1 |
| **Total** | **8** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 11.4 ml |
| Ipsilateral kidney volume | 184 ml |
| Contralateral kidney volume | 189 ml |
| Ipsilateral share of total renal volume | 49% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 21.8 ml |
| Parenchyma inside the margin | 10.5 ml |
| Residual ipsilateral parenchyma | 174 ml (94% preserved) |
| Tumour-parenchyma contact surface | 33.6 cm2 |
| Tumour to sinus | 27.3 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
