# Published reference cases

The site publishes 5 real kidneys built from the KiTS23 reference
labels. They appear under neutral letters because the deploy bundle scan forbids
cohort identifiers in any published pathname or text file. This file records the
mapping and is never deployed.

Regenerate with:

```
node scripts/make-reference-cases.mjs [path-to-glb-source-dir]
```

| Published as | Cohort case | Meshes in the file |
| --- | --- | --- |
| reference-a | `case_00000` | parenchyma, tumour |
| reference-b | `case_00001` | parenchyma, tumour |
| reference-c | `case_00002` | parenchyma, tumour, cyst, ribs, psoas, colon, spleen, liver, skin |
| reference-d | `case_00003` | parenchyma, tumour |
| reference-e | `case_00004` | parenchyma, tumour |

Nephrometry shown on the site is read from each case's `planning.json`, as
computed by renalplan from the mesh geometry. KiTS23 is used under
CC BY-NC-SA 4.0; these meshes are a derivative of the reference labels and carry
the same non-commercial share-alike terms.
