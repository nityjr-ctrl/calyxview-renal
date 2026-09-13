# case_00000: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:11:27.515765+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 3.1 cm | 1 |
| E: exophytic fraction | 23% outside the parenchymal outline | 2 |
| N: nearness to sinus / collecting system | 39.8 mm | 1 |
| A: anterior / posterior | p | - |
| L: polar location | entirely above or below the polar lines | 1 |
| Hilar | no / not assessed | - |
| **Total** | **5p** | low complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | inferior | 1 |
| Exophytic rate | see above | 2 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 3.1 cm | 1 |
| **Total** | **7** | low |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

## Resection geometry (illustrative)

| Quantity | Value |
| --- | --- |
| Tumour volume | 8.7 ml |
| Ipsilateral kidney volume | 190 ml |
| Contralateral kidney volume | 172 ml |
| Ipsilateral share of total renal volume | 53% |
| Margin modelled | 5 mm uniform |
| Resection volume (tumour + margin within kidney) | 16.6 ml |
| Parenchyma inside the margin | 7.9 ml |
| Residual ipsilateral parenchyma | 182 ml (96% preserved) |
| Tumour-parenchyma contact surface | 20.8 cm2 |
| Tumour to sinus | 39.8 mm |

Notes: Margin envelope is a uniform dilation of the tumour; not a surgical plan.
