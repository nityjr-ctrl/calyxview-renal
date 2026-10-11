export function CtPhaseNote({ label }: { label: string }) {
  return <aside className="ct-phase-note" aria-label={`${label} CT phase and model coverage`}>
    <p className="ct-phase-collecting"><strong>{label}: collecting system and calyces not reconstructed.</strong> No delayed (excretory) CT phase is supplied for this KiTS example.</p>
    <p className="ct-phase-vessels"><strong>Arteries and veins not reconstructed.</strong> These KiTS outlines do not include blood vessels. Suitable arterial/venous CT phases and a dedicated vessel segmentation model are needed.</p>
    <p className="ct-phase-next">With suitable CT phases and the appropriate segmentation model, these structures can be reconstructed, then checked and corrected against the scan. Their absence here is a limit of this reconstruction.</p>
  </aside>;
}
