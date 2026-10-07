# Editorial design direction

The overview borrows the *design philosophy* of Incept 3D's public website without copying its text, brand, layouts or media. The reference review covered the [CT-to-3D page](https://incept3d.com/ct-scan-to-3d-print), [home page](https://incept3d.com/), [3D printing](https://incept3d.com/3d-printing), [product design](https://incept3d.com/product-design), [software](https://incept3d.com/software), [about](https://incept3d.com/about-us) and [FAQ](https://incept3d.com/frequently-asked-questions).

The reusable ideas are:

- Lead with a large, tangible result before explaining the process.
- Use oversized, literal headlines and generous whitespace.
- Move from outcome to explanation, numbered process, practical uses and one repeated next action.
- Alternate warm editorial surfaces with a dark process environment.
- Use motion only when it demonstrates the object or workflow.
- Collapse layouts into a simple reading order on mobile.

CalyxView Renal expresses those principles through its own deep-renal-green, warm-paper, mint and coral palette, original wording, real KiTS23 CT and live 3D anatomy.

## Hero image

Since October 2026 the hero shows a real CT still: `public/ct/reference-c/key.webp`, the axial slice through the centre of Kidney C's tumour with the KiTS kidney and tumour outlines drawn on, made by `scripts/make-ct-slices.py` (KiTS23, de-identified, CC BY-NC-SA 4.0). The same stills head the five kidney cards. The page follows Cruip's Appy template in feel: big Red Hat Display headings, generous space, the images doing most of the talking.

The earlier hero, `public/calyxview-renal-hero.webp`, was an AI-generated illustration and has been removed. Its prompt is kept below for the record. The social preview (`public/og.jpg`, see `social-preview.md`) is still a separate AI-generated illustration.

Old hero prompt:

> Use case: website hero imagery for an original medical education and planning prototype. Create a premium editorial photograph, wide 16:10 landscape, of a life-size 3D printed human kidney model on a matte charcoal rotating display plinth in a calm modern design studio. The kidney is anatomically plausible and made from layered translucent materials: warm ivory renal parenchyma, a small restrained coral cortical tumour, subtle amber renal arterial branches, muted blue venous branches, and a pale aqua collecting system visible through the model. Three-quarter view, model placed slightly right of centre with generous clean dark-to-warm-grey negative space on the left for headline copy. Background is softly blurred shelves with a few neutral anatomical prototypes, but no identifiable people. Natural window light plus a precise soft rim light, tangible physical object, fine layer-line detail, museum-quality product photography, reassuring and sophisticated rather than futuristic. No blood, no gore, no surgery scene, no patient, no hands, no text, no logo, no UI, no labels, no arrows, no watermark, and do not recreate the supplied skull image or any recognisable reference-site asset.
