# case_00001: CT-to-3D partial nephrectomy planning summary

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-03T09:12:49.706954+00:00 by renalplan 0.1.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 2.6 cm | 1 |
| E: exophytic fraction | 0% outside the parenchymal outline | 3 |
| N: nearness to sinus / collecting system | 1.1 mm | 3 |
| A: anterior / posterior | a | - |
| L: polar location | entirely between the polar lines | 3 |
| Hilar | no / not assessed | - |
| **Total** | **10a** | high complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle | 2 |
| Exophytic rate | see above | 3 |
| Renal rim | medial | 2 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 2.6 cm | 1 |
| **Total** | **10** | high |

Assumptions: 1 additional tumour component(s) present; scores refer to the largest (index) lesion. Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour.

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
