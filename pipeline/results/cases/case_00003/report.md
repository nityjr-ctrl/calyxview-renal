# case_00003: computed nephrometry and volumes

> Research and teaching prototype. Not a medical device. Not for diagnosis, treatment selection, surgical planning, margin selection or patient care.

Generated 2026-09-29T21:06:54.670771+00:00 by renalplan 0.2.0.

## Nephrometry (computed from masks)

| R.E.N.A.L. component | Value | Points |
| --- | --- | --- |
| R: maximal diameter | 3.2 cm | 1 |
| E: exophytic fraction | 2.5% outside the parenchymal outline (5% or less counts as entirely endophytic) | 3 |
| N: nearness to sinus / collecting system | 27.3 mm | 1 |
| A: anterior / posterior | x | - |
| L: polar location | more than half between the polar lines | 3 |
| Hilar | no / not assessed | - |
| **Total** | **8x** | moderate complexity |

| PADUA component | Value | Points |
| --- | --- | --- |
| Polar location | middle (more than half of the tumour between the polar lines) | 2 |
| Exophytic rate | see above | 3 |
| Renal rim | lateral | 1 |
| Renal sinus involvement | no | 1 |
| Collecting system involvement | not assessed (no excretory phase) | 1 |
| Tumour size | 3.2 cm | 1 |
| **Total** | **9** | intermediate |

Assumptions: Renal sinus approximated as the hull-enclosed space that is not parenchyma or tumour. Polar lines here are planes across the kidney's own long axis, not axial CT slices, and one pair serves both R.E.N.A.L. L and PADUA's polar item, though the two systems define their lines differently. PADUA's polar item is middle (2) when more than half the tumour lies between the lines, the rule Wood et al. (BJU Int 2024) used to automate PADUA. So L and PADUA's polar item are approximations. Sinus estimate too short or off-centre to set the polar lines; polar lines assumed where 30% of the kidney's volume lies beyond each (its 30th and 70th percentiles along the long axis), so L and PADUA's polar item are approximate. N and PADUA's rim and renal-sinus items still use that estimate, so they are approximate too, and N can read long.

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
