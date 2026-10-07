/**
 * The boundary a clinical service would sit behind.
 *
 * The site has no server and never receives a scan. The builder ("Make a 3D
 * kidney") reads a label map in the visitor's own tab and sends nothing
 * anywhere. A future clinical service that took scans in would implement
 * SegmentationGateway, and only after an approved de-identification,
 * security, validation and regulatory programme. It would accept a receipt
 * from an approved de-identification service, never raw files picked in a
 * browser. Until then the gateway is null.
 */

export type AuthorisedDeidentifiedStudy = {
  receiptId: string;
  studyUid: string;
  objectCount: number;
  deidentificationProfile: string;
  reviewedBy: string;
};

export type SegmentationJob = {
  jobId: string;
  state: 'queued' | 'validating' | 'segmenting' | 'review-required' | 'failed';
};

export interface SegmentationGateway {
  /** Accept only a receipt from an approved de-identification service. */
  start(study: AuthorisedDeidentifiedStudy): Promise<SegmentationJob>;
  status(jobId: string): Promise<SegmentationJob>;
}

export const segmentationGateway: SegmentationGateway | null = null;
