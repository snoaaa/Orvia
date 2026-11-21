export type DocumentProcessingState =
  | "pending"
  | "ocr"
  | "segmentation"
  | "indexing"
  | "available"
  | "error";

export interface DocumentVersionSummary {
  id: string;
  versionNumber: number;
  mimeType: string;
  fileSizeBytes?: number;
  status: DocumentProcessingState;
  errorReason?: string | null;
  createdAt: string;
}

export interface DocumentItem {
  id: string;
  spaceId: string;
  title: string;
  author?: string | null;
  tags?: string[];
  currentVersion?: DocumentVersionSummary | null;
  isOffline?: boolean;
  localUri?: string | null;
  updatedAt?: string;
}
