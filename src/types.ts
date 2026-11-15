export type UUID = string;

export const CURRENT_SCHEMA_VERSION = 3;
export const APP_VERSION = '1.0.0';

/**
 * Structured rich text representation (no raw HTML strings).
 */
export interface TextSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
}

export type ContentBlockType = 'heading' | 'paragraph' | 'bullet' | 'quote';

export interface ContentBlock {
  id: UUID;
  type: ContentBlockType;
  spans: TextSpan[];
}

export interface NodeMetadata {
  createdAt: string;
  updatedAt: string;
  owner: 'user' | 'system' | 'migration';
  tags: string[];
  deletedAt?: string | null; // Tombstone support for future sync
}

export interface CrossMapReference {
  id: UUID;
  targetMapId: UUID;
  targetNodeId: UUID;
  label?: string;
}

export interface GraphNode {
  id: UUID;
  mapId: UUID;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  collapsed: boolean;
  blocks: ContentBlock[];
  nestedMapId?: UUID | null;
  attachmentIds: UUID[];
  crossMapRefs: CrossMapReference[];
  metadata: NodeMetadata;
}

export interface GraphEdge {
  id: UUID;
  mapId: UUID;
  sourceId: UUID;
  targetId: UUID;
  label: string;
  style: 'solid' | 'dashed';
  directed: boolean;
  metadata: {
    createdAt: string;
    updatedAt: string;
    owner: 'user' | 'system' | 'migration';
    deletedAt?: string | null;
  };
}

export interface MindMapDocument {
  id: UUID;
  title: string;
  parentMapId?: UUID | null;
  parentNodeId?: UUID | null;
  viewport: {
    panX: number;
    panY: number;
    zoom: number;
  };
  nodes: Record<UUID, GraphNode>;
  edges: Record<UUID, GraphEdge>;
  metadata: {
    createdAt: string;
    updatedAt: string;
    owner: 'user' | 'system' | 'migration';
  };
}

export interface AttachmentMeta {
  id: UUID;
  name: string;
  mimeType: string;
  size: number;
  createdAt: string;
}

export interface WorkspaceEnvelope {
  schemaVersion: number;
  appVersion: string;
  exportedAt?: string;
  activeMapId: UUID;
  maps: Record<UUID, MindMapDocument>;
  attachments: Record<UUID, AttachmentMeta>;
}

export interface BinaryAttachmentRecord {
  meta: AttachmentMeta;
  data: ArrayBuffer;
}

export interface ExportedWorkspaceBundle {
  envelope: WorkspaceEnvelope;
  /** Base64-encoded attachment blobs keyed by attachment UUID for portable offline backup */
  embeddedAttachments?: Record<UUID, { meta: AttachmentMeta; base64Data: string }>;
}

export type SaveStatus =
  | { state: 'idle' }
  | { state: 'saving' }
  | { state: 'saved'; timestamp: string }
  | { state: 'error'; message: string; timestamp: string };

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
