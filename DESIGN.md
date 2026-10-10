# CalyxView Renal: editorial research site

Direction chosen under Nity's full editorial brief, 10 October 2026. This replaces the initial single-page atlas design with a complete editorial rebuild.

The site should feel like a colleague's carefully assembled clinical atlas: a place to look closely at anatomy and examine the evidence. It is a research and teaching prototype, not a clinical planning service.

Dial: ENERGY 2 / RHYTHM 3 / MOTION 1.

- Warm ivory paper and dark brown-black ink give the long research sections a comfortable reading ground. Rust is reserved for the opening action and active focus; supporting actions use ink.
- Georgia headings recall the typography of medical books and provide a distinct, locally available editorial voice. Segoe UI/system sans keeps small controls and measurements clear, without new font downloads.
- The opening pairs a short title with a real KiTS23 CT. Its caption and case link make the image evidence and an entry point, not decoration.
- Five comparable case rows replace cramped cards. Each row gives its CT, case name, source-derived scores and two actions enough space. Equal treatment is appropriate because the reader is comparing the same measurements.
- Home introduces the work and provides a short numbered contents list. Cases, Build a model, Methods & evidence, and About are separate destinations. Research splits into scoring/model methods and segmentation evidence. These are different questions with different denominators, not one validation claim.
- Case comparisons use repeatable rows. The builder guide uses a start panel beside practical instructions. The About page has an author column and study text. Evidence keeps comparison tables and metric groups, where equal treatment helps comparison.
- Fine horizontal rules separate cases and sections. Numbers in the home contents represent reading order. There are no decorative stripes, grids, promotional badges or background patterns.
- Buttons use 3px corners; images and tables are square. The mobile menu expands in the document rather than obscuring content. No decorative shadows or scroll animation.
- The workspace remains dark because grayscale CT and translucent anatomy need a stable viewing ground. Warm typography connects it to the atlas. Anatomical layer colours carry data and are exempt from the editorial palette limit.
- The illustrative model opens in the workspace rather than consuming resources in the page. All motion is tied to direct manipulation or real processing. Hover and focus changes provide feedback.
- Eye, view, layer and download icons remain compact control labels in the workspace. The cube denotes a 3D model, not AI. Spinners appear only during real loading or export work; source labels identify expert, synthetic or locally built anatomy.
- Existing research values, scoring rules, source attribution and limitations stay intact. No new evidence, testimonials or clinical claims are invented.
- Copy uses a concise professional register. It names the input, result and limitation. "Volumes" replaces "Plan" because the viewer calculates volumes rather than a clinical plan. The builder's detailed methods use a disclosure, with material scoring limitations always visible.
- Generic approach/clamping notes have been removed from the volume panels: they did not explain the displayed calculation and could be mistaken for case-specific recommendations. "Illustrative" consistently identifies the synthetic anatomy. No computational capabilities were removed.
- Browser processing, offline Python results and the historical segmentation benchmark remain distinct. The guide preserves the exact-hull versus sampled-hull qualification; case scores retain sinus, pole and collecting-system caveats.
- Share metadata uses the actual Kidney C CT rather than the earlier generated illustration. No new medical imagery is fabricated.
- The workspace uses icons for view direction, layer visibility, export and warnings. Metric direction arrows encode better/worse values. External-link marks signal a new tab. Promotional icons are absent; redundant research-card icons are hidden.

## Acceptance outcomes

1. All public sections have a clear purpose, revised copy and coherent design. Page routes, legacy fragments, Back/Forward, reload and return focus work.
2. Five case/CT entries, the illustrative model, builder sample/file states, model controls and exports retain real behaviour. Mobile layouts and keyboard focus work; errors remain actionable.
3. Existing tests, lint, typecheck and production bundle scan pass. Browser review records actual interactions, contrast findings and screenshots.
4. The finished change is committed, pushed and published to the existing Netlify site, with the live asset revision checked against the build.
