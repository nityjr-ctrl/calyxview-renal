/**
 * Safe demo boundary.
 *
 * This module deliberately exposes only a local file inventory and a synthetic
 * result. A future clinical service can implement SegmentationGateway after an
 * approved de-identification, security, validation, and regulatory programme.
 * Nothing in the current app sends pixel data or DICOM metadata to a server.
 */

export type LocalStudyManifest = {
  fileCount: number;
  totalBytes: number;
  dicomLikeCount: number;
  otherFileCount: number;
  createdAt: string;
};

export type PipelineStage = {
  id: 'inventory' | 'privacy' | 'quality' | 'segmentation' | 'mesh' | 'review';
  label: string;
  prototypeBehaviour: string;
  productionRequirement: string;
};

export const PROTOTYPE_STAGES: PipelineStage[] = [
  {
    id: 'inventory',
    label: 'Study inventory',
    prototypeBehaviour: 'Counts selected files in this browser tab.',
    productionRequirement:
      'Group and validate instances by DICOM Study, Series, SOP and Frame of Reference UIDs.',
  },
  {
    id: 'privacy',
    label: 'Privacy preflight',
    prototypeBehaviour:
      'Shows safety checks without reading or altering DICOM contents.',
    productionRequirement:
      'Validated PS3.15 de-identification plus private-tag, nested-content and burned-in-pixel review.',
  },
  {
    id: 'quality',
    label: 'Protocol quality',
    prototypeBehaviour: 'Uses illustrative, pre-authored quality results.',
    productionRequirement:
      'Verify modality, coverage, spacing, phase, contrast timing, orientation, duplicates and artifacts.',
  },
  {
    id: 'segmentation',
    label: 'Anatomy segmentation',
    prototypeBehaviour: 'Loads the built-in synthetic renal case.',
    productionRequirement:
      'Run validated, phase-aware kidney, tumour, arterial, venous and collecting-system models with uncertainty.',
  },
  {
    id: 'mesh',
    label: '3D reconstruction',
    prototypeBehaviour: 'Renders procedural training anatomy in Three.js.',
    productionRequirement:
      'Create topology-checked meshes in patient coordinates and preserve millimetre scale and provenance.',
  },
  {
    id: 'review',
    label: 'Clinical review',
    prototypeBehaviour: 'Displays a simulated QA checklist.',
    productionRequirement:
      'Require radiologist/urologist correction and approval before any structure or measurement is verified.',
  },
];

export function createLocalStudyManifest(files: File[]): LocalStudyManifest {
  const dicomLikeCount = files.filter((file) =>
    /\.(dcm|dicom)$/i.test(file.name),
  ).length;

  return {
    fileCount: files.length,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
    dicomLikeCount,
    otherFileCount: files.length - dicomLikeCount,
    createdAt: new Date().toISOString(),
  };
}

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
  /** Accept only a receipt from an approved PHI quarantine/de-identification service. */
  start(study: AuthorisedDeidentifiedStudy): Promise<SegmentationJob>;
  status(jobId: string): Promise<SegmentationJob>;
}

export const segmentationGateway: SegmentationGateway | null = null;
