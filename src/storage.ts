import {
  APP_VERSION,
  AttachmentMeta,
  BinaryAttachmentRecord,
  CURRENT_SCHEMA_VERSION,
  ContentBlock,
  ExportedWorkspaceBundle,
  GraphEdge,
  GraphNode,
  MindMapDocument,
  UUID,
  ValidationResult,
  WorkspaceEnvelope,
} from './types';

// ============================================================================
// 1. UUID & Structured Document Helpers
// ============================================================================

export function generateUUID(): UUID {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(value: unknown): value is UUID {
  return typeof value === 'string' && UUID_REGEX.test(value);
}

export function createStructuredBlocksFromPlainText(text: string): ContentBlock[] {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || (lines.length === 1 && lines[0].trim() === '')) {
    return [
      {
        id: generateUUID(),
        type: 'paragraph',
        spans: [{ text: '' }],
      },
    ];
  }

  return lines.map((line) => {
    if (line.startsWith('# ')) {
      return {
        id: generateUUID(),
        type: 'heading',
        spans: [{ text: line.slice(2) }],
      };
    }
    if (line.startsWith('- ') || line.startsWith('* ')) {
      return {
        id: generateUUID(),
        type: 'bullet',
        spans: [{ text: line.slice(2) }],
      };
    }
    if (line.startsWith('> ')) {
      return {
        id: generateUUID(),
        type: 'quote',
        spans: [{ text: line.slice(2) }],
      };
    }
    return {
      id: generateUUID(),
      type: 'paragraph',
      spans: parseInlineSpans(line),
    };
  });
}

export function parseInlineSpans(line: string) {
  // Lightweight deterministic parser for **bold**, *italic*, and `code`
  const tokens: { text: string; bold?: boolean; italic?: boolean; code?: boolean }[] = [];
  const regex = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ text: line.slice(lastIndex, match.index) });
    }
    const raw = match[0];
    if (raw.startsWith('**') && raw.endsWith('**')) {
      tokens.push({ text: raw.slice(2, -2), bold: true });
    } else if (raw.startsWith('*') && raw.endsWith('*')) {
      tokens.push({ text: raw.slice(1, -1), italic: true });
    } else if (raw.startsWith('`') && raw.endsWith('`')) {
      tokens.push({ text: raw.slice(1, -1), code: true });
    }
    lastIndex = regex.lastIndex;
  }

  if (lastIndex < line.length) {
    tokens.push({ text: line.slice(lastIndex) });
  }

  return tokens.length > 0 ? tokens : [{ text: line }];
}

export function serializeBlocksToPlainText(blocks: ContentBlock[]): string {
  return blocks
    .map((block) => {
      const inner = block.spans
        .map((s) => {
          if (s.bold) return `**${s.text}**`;
          if (s.italic) return `*${s.text}*`;
          if (s.code) return `\`${s.text}\``;
          return s.text;
        })
        .join('');
      if (block.type === 'heading') return `# ${inner}`;
      if (block.type === 'bullet') return `- ${inner}`;
      if (block.type === 'quote') return `> ${inner}`;
      return inner;
    })
    .join('\n');
}

// ============================================================================
// 2. Default Seed Workspace
// ============================================================================

export function createSeedWorkspace(): WorkspaceEnvelope {
  const now = new Date().toISOString();
  const rootMapId = generateUUID();
  const subMapId = generateUUID();

  const node1Id = generateUUID();
  const node2Id = generateUUID();
  const node3Id = generateUUID();
  const subNode1Id = generateUUID();
  const subNode2Id = generateUUID();

  const rootMap: MindMapDocument = {
    id: rootMapId,
    title: 'Workspace Overview',
    parentMapId: null,
    parentNodeId: null,
    viewport: { panX: 80, panY: 80, zoom: 1 },
    nodes: {
      [node1Id]: {
        id: node1Id,
        mapId: rootMapId,
        title: 'Spatial Knowledge Canvas',
        x: 120,
        y: 120,
        width: 280,
        height: 185,
        color: '#fef9c3',
        collapsed: false,
        blocks: [
          {
            id: generateUUID(),
            type: 'paragraph',
            spans: [
              { text: 'Organize ideas spatially using ' },
              { text: 'connected cards', bold: true },
              { text: ' and nested sub-canvases.' },
            ],
          },
          {
            id: generateUUID(),
            type: 'bullet',
            spans: [{ text: 'Double-click canvas to add a card' }],
          },
          {
            id: generateUUID(),
            type: 'bullet',
            spans: [{ text: 'Press C to link source -> target' }],
          },
        ],
        nestedMapId: null,
        attachmentIds: [],
        crossMapRefs: [],
        metadata: {
          createdAt: now,
          updatedAt: now,
          owner: 'system',
          tags: ['intro'],
          deletedAt: null,
        },
      },
      [node2Id]: {
        id: node2Id,
        mapId: rootMapId,
        title: 'Architecture & Engines',
        x: 500,
        y: 90,
        width: 290,
        height: 195,
        color: '#dbeafe',
        collapsed: false,
        blocks: [
          {
            id: generateUUID(),
            type: 'paragraph',
            spans: [
              { text: 'This node contains a ' },
              { text: 'nested sub-map', bold: true },
              { text: '. Click "Open Sub-Canvas" to dive in.' },
            ],
          },
          {
            id: generateUUID(),
            type: 'quote',
            spans: [{ text: 'Graph, Document, and Persistence engines are decoupled.' }],
          },
        ],
        nestedMapId: subMapId,
        attachmentIds: [],
        crossMapRefs: [
          {
            id: generateUUID(),
            targetMapId: subMapId,
            targetNodeId: subNode1Id,
            label: 'Persistence Engine Spec',
          },
        ],
        metadata: {
          createdAt: now,
          updatedAt: now,
          owner: 'system',
          tags: ['architecture'],
          deletedAt: null,
        },
      },
      [node3Id]: {
        id: node3Id,
        mapId: rootMapId,
        title: 'Offline Persistence & Backups',
        x: 320,
        y: 360,
        width: 290,
        height: 170,
        color: '#dcfce7',
        collapsed: false,
        blocks: [
          {
            id: generateUUID(),
            type: 'bullet',
            spans: [{ text: 'IndexedDB repository with clean connection closing' }],
          },
          {
            id: generateUUID(),
            type: 'bullet',
            spans: [{ text: 'Versioned JSON export & schema validation' }],
          },
        ],
        nestedMapId: null,
        attachmentIds: [],
        crossMapRefs: [],
        metadata: {
          createdAt: now,
          updatedAt: now,
          owner: 'system',
          tags: ['storage'],
          deletedAt: null,
        },
      },
    },
    edges: {
      [generateUUID()]: {
        id: generateUUID(),
        mapId: rootMapId,
        sourceId: node1Id,
        targetId: node2Id,
        label: 'built with',
        style: 'solid',
        directed: true,
        metadata: { createdAt: now, updatedAt: now, owner: 'system', deletedAt: null },
      },
      [generateUUID()]: {
        id: generateUUID(),
        mapId: rootMapId,
        sourceId: node1Id,
        targetId: node3Id,
        label: 'persisted via',
        style: 'dashed',
        directed: true,
        metadata: { createdAt: now, updatedAt: now, owner: 'system', deletedAt: null },
      },
    },
    metadata: {
      createdAt: now,
      updatedAt: now,
      owner: 'system',
    },
  };

  // Ensure edge object keys match edge.id
  const normalizedRootEdges: Record<UUID, GraphEdge> = {};
  Object.values(rootMap.edges).forEach((edge) => {
    normalizedRootEdges[edge.id] = edge;
  });
  rootMap.edges = normalizedRootEdges;

  const subMap: MindMapDocument = {
    id: subMapId,
    title: 'Architecture & Engines (Nested)',
    parentMapId: rootMapId,
    parentNodeId: node2Id,
    viewport: { panX: 80, panY: 80, zoom: 1 },
    nodes: {
      [subNode1Id]: {
        id: subNode1Id,
        mapId: subMapId,
        title: 'Persistence Engine (v3)',
        x: 140,
        y: 130,
        width: 280,
        height: 170,
        color: '#f3e8ff',
        collapsed: false,
        blocks: [
          {
            id: generateUUID(),
            type: 'paragraph',
            spans: [{ text: 'Sequential deterministic migrations with pre-migration backup snapshots.' }],
          },
        ],
        nestedMapId: null,
        attachmentIds: [],
        crossMapRefs: [],
        metadata: { createdAt: now, updatedAt: now, owner: 'system', deletedAt: null },
      },
      [subNode2Id]: {
        id: subNode2Id,
        mapId: subMapId,
        title: 'Document Engine',
        x: 490,
        y: 150,
        width: 280,
        height: 170,
        color: '#ffedd5',
        collapsed: false,
        blocks: [
          {
            id: generateUUID(),
            type: 'paragraph',
            spans: [{ text: 'Structured ContentBlocks, binary attachments, and cross-map links.' }],
          },
        ],
        nestedMapId: null,
        attachmentIds: [],
        crossMapRefs: [],
        metadata: { createdAt: now, updatedAt: now, owner: 'system', deletedAt: null },
      },
    },
    edges: {},
    metadata: { createdAt: now, updatedAt: now, owner: 'system' },
  };

  const subEdgeId = generateUUID();
  subMap.edges[subEdgeId] = {
    id: subEdgeId,
    mapId: subMapId,
    sourceId: subNode2Id,
    targetId: subNode1Id,
    label: 'delegates storage to',
    style: 'solid',
    directed: true,
    metadata: { createdAt: now, updatedAt: now, owner: 'system', deletedAt: null },
  };

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    activeMapId: rootMapId,
    maps: {
      [rootMapId]: rootMap,
      [subMapId]: subMap,
    },
    attachments: {},
  };
}

// ============================================================================
// 3. Deterministic Sequential Schema Migration Framework (v1 -> v2 -> v3)
// ============================================================================

export interface MigrationResult {
  migrated: boolean;
  fromVersion: number;
  toVersion: number;
  envelope: WorkspaceEnvelope;
  backupSnapshot?: unknown;
}

/**
 * Deterministic sequential migrations:
 * - v1: Legacy flat single-map format ({ version: 1, nodes: [...], edges: [...] })
 *       with array-index or arbitrary string IDs and HTML/string bodies.
 * - v2: Multi-map envelope with UUIDs and structured ContentBlocks, lacking
 *       attachments, crossMapRefs, and tombstones.
 * - v3: Current schema with attachments, crossMapRefs, metadata ownership, and tombstones.
 */
export function migrateWorkspacePayload(rawInput: unknown): MigrationResult {
  if (!rawInput || typeof rawInput !== 'object') {
    throw new Error('Cannot migrate non-object workspace payload.');
  }

  // Deep clone input to preserve original raw snapshot intact
  const originalSnapshot = JSON.parse(JSON.stringify(rawInput));
  let working: Record<string, unknown> = JSON.parse(JSON.stringify(rawInput));

  // Unwrap if exported bundle envelope
  if ('envelope' in working && working.envelope && typeof working.envelope === 'object') {
    working = working.envelope as Record<string, unknown>;
  }

  const detectedVersion =
    typeof working.schemaVersion === 'number'
      ? working.schemaVersion
      : typeof working.version === 'number'
      ? working.version
      : 1;

  if (detectedVersion > CURRENT_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported future schemaVersion ${detectedVersion}. Maximum supported is ${CURRENT_SCHEMA_VERSION}.`
    );
  }

  if (detectedVersion < 1 || !Number.isInteger(detectedVersion)) {
    throw new Error(`Invalid schemaVersion: ${String(detectedVersion)}`);
  }

  if (detectedVersion === CURRENT_SCHEMA_VERSION) {
    return {
      migrated: false,
      fromVersion: detectedVersion,
      toVersion: CURRENT_SCHEMA_VERSION,
      envelope: working as unknown as WorkspaceEnvelope,
    };
  }

  let currentVersion = detectedVersion;

  // Step 1: v1 -> v2
  if (currentVersion === 1) {
    const now = new Date().toISOString();
    const mapId = generateUUID();
    const idMap = new Map<string, UUID>();

    const rawNodes = Array.isArray(working.nodes)
      ? working.nodes
      : working.nodes && typeof working.nodes === 'object'
      ? Object.values(working.nodes)
      : [];

    const migratedNodes: Record<UUID, Record<string, unknown>> = {};

    rawNodes.forEach((rawNode: unknown, index: number) => {
      const n = (rawNode && typeof rawNode === 'object' ? rawNode : {}) as Record<string, unknown>;
      const legacyId = String(n.id ?? index);
      const newId = isValidUUID(legacyId) ? legacyId : generateUUID();
      idMap.set(legacyId, newId);

      const plainText =
        typeof n.content === 'string'
          ? n.content.replace(/<[^>]+>/g, '')
          : typeof n.body === 'string'
          ? n.body
          : '';

      migratedNodes[newId] = {
        id: newId,
        mapId,
        title: typeof n.title === 'string' ? n.title : `Node ${index + 1}`,
        x: typeof n.x === 'number' && Number.isFinite(n.x) ? n.x : 100 + index * 40,
        y: typeof n.y === 'number' && Number.isFinite(n.y) ? n.y : 100 + index * 40,
        width: typeof n.width === 'number' && n.width >= 140 ? n.width : 260,
        height: typeof n.height === 'number' && n.height >= 90 ? n.height : 150,
        color: typeof n.color === 'string' ? n.color : '#fef9c3',
        collapsed: Boolean(n.collapsed),
        blocks: Array.isArray(n.blocks) ? n.blocks : createStructuredBlocksFromPlainText(plainText),
        nestedMapId: null,
        metadata: {
          createdAt: now,
          updatedAt: now,
          owner: 'migration',
          tags: [],
        },
      };
    });

    const rawEdges = Array.isArray(working.edges)
      ? working.edges
      : working.edges && typeof working.edges === 'object'
      ? Object.values(working.edges)
      : [];

    const migratedEdges: Record<UUID, Record<string, unknown>> = {};
    rawEdges.forEach((rawEdge: unknown) => {
      const e = (rawEdge && typeof rawEdge === 'object' ? rawEdge : {}) as Record<string, unknown>;
      const srcLegacy = String(e.sourceId ?? e.from ?? e.source ?? '');
      const tgtLegacy = String(e.targetId ?? e.to ?? e.target ?? '');
      const sourceId = idMap.get(srcLegacy) ?? (isValidUUID(srcLegacy) ? srcLegacy : null);
      const targetId = idMap.get(tgtLegacy) ?? (isValidUUID(tgtLegacy) ? tgtLegacy : null);
      if (sourceId && targetId && migratedNodes[sourceId] && migratedNodes[targetId]) {
        const edgeId = isValidUUID(e.id) ? e.id : generateUUID();
        migratedEdges[edgeId] = {
          id: edgeId,
          mapId,
          sourceId,
          targetId,
          label: typeof e.label === 'string' ? e.label : '',
          style: e.style === 'dashed' ? 'dashed' : 'solid',
          directed: e.directed !== false,
          metadata: {
            createdAt: now,
            updatedAt: now,
            owner: 'migration',
          },
        };
      }
    });

    working = {
      schemaVersion: 2,
      appVersion: APP_VERSION,
      activeMapId: mapId,
      maps: {
        [mapId]: {
          id: mapId,
          title: typeof working.title === 'string' ? working.title : 'Migrated Map',
          parentMapId: null,
          parentNodeId: null,
          viewport: { panX: 0, panY: 0, zoom: 1 },
          nodes: migratedNodes,
          edges: migratedEdges,
          metadata: {
            createdAt: now,
            updatedAt: now,
            owner: 'migration',
          },
        },
      },
    };
    currentVersion = 2;
  }

  // Step 2: v2 -> v3
  if (currentVersion === 2) {
    const now = new Date().toISOString();
    const maps = (working.maps && typeof working.maps === 'object' ? working.maps : {}) as Record<
      string,
      Record<string, unknown>
    >;

    for (const mapObj of Object.values(maps)) {
      const nodes = (mapObj.nodes && typeof mapObj.nodes === 'object' ? mapObj.nodes : {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const nodeObj of Object.values(nodes)) {
        if (!Array.isArray(nodeObj.attachmentIds)) {
          nodeObj.attachmentIds = [];
        }
        if (!Array.isArray(nodeObj.crossMapRefs)) {
          nodeObj.crossMapRefs = [];
        }
        const meta = (nodeObj.metadata && typeof nodeObj.metadata === 'object'
          ? nodeObj.metadata
          : {}) as Record<string, unknown>;
        nodeObj.metadata = {
          createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : now,
          updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : now,
          owner: meta.owner === 'user' || meta.owner === 'system' ? meta.owner : 'migration',
          tags: Array.isArray(meta.tags) ? meta.tags : [],
          deletedAt: typeof meta.deletedAt === 'string' ? meta.deletedAt : null,
        };
      }

      const edges = (mapObj.edges && typeof mapObj.edges === 'object' ? mapObj.edges : {}) as Record<
        string,
        Record<string, unknown>
      >;
      for (const edgeObj of Object.values(edges)) {
        const meta = (edgeObj.metadata && typeof edgeObj.metadata === 'object'
          ? edgeObj.metadata
          : {}) as Record<string, unknown>;
        edgeObj.metadata = {
          createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : now,
          updatedAt: typeof meta.updatedAt === 'string' ? meta.updatedAt : now,
          owner: meta.owner === 'user' || meta.owner === 'system' ? meta.owner : 'migration',
          deletedAt: typeof meta.deletedAt === 'string' ? meta.deletedAt : null,
        };
      }
    }

    working.attachments =
      working.attachments && typeof working.attachments === 'object' ? working.attachments : {};
    working.schemaVersion = 3;
    working.appVersion = APP_VERSION;
    currentVersion = 3;
  }

  return {
    migrated: true,
    fromVersion: detectedVersion,
    toVersion: CURRENT_SCHEMA_VERSION,
    envelope: working as unknown as WorkspaceEnvelope,
    backupSnapshot: originalSnapshot,
  };
}

// ============================================================================
// 4. Strict Data Validation (Nodes, Edges, Maps, Integrity)
// ============================================================================

export function validateWorkspaceEnvelope(data: unknown): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Root payload must be a JSON object.'], warnings };
  }

  const env = data as Record<string, unknown>;

  if (env.schemaVersion !== CURRENT_SCHEMA_VERSION) {
    errors.push(
      `Expected schemaVersion ${CURRENT_SCHEMA_VERSION}, got ${String(env.schemaVersion)}.`
    );
  }

  if (!isValidUUID(env.activeMapId)) {
    errors.push('activeMapId must be a valid UUID.');
  }

  if (!env.maps || typeof env.maps !== 'object' || Array.isArray(env.maps)) {
    errors.push('maps must be a non-empty dictionary keyed by map UUID.');
    return { valid: false, errors, warnings };
  }

  const maps = env.maps as Record<string, unknown>;
  const mapIds = Object.keys(maps);
  if (mapIds.length === 0) {
    errors.push('Workspace must contain at least one map.');
  }

  if (isValidUUID(env.activeMapId) && !maps[env.activeMapId]) {
    errors.push(`activeMapId "${env.activeMapId}" does not exist in maps.`);
  }

  const allNodesByMap = new Map<UUID, Set<UUID>>();

  // Pass 1: Validate maps and nodes
  for (const [mapKey, rawMap] of Object.entries(maps)) {
    if (!isValidUUID(mapKey)) {
      errors.push(`Map key "${mapKey}" is not a valid UUID.`);
      continue;
    }
    if (!rawMap || typeof rawMap !== 'object') {
      errors.push(`Map "${mapKey}" must be an object.`);
      continue;
    }
    const mapObj = rawMap as Record<string, unknown>;
    if (mapObj.id !== mapKey) {
      errors.push(`Map key "${mapKey}" mismatches map.id "${String(mapObj.id)}".`);
    }
    if (typeof mapObj.title !== 'string' || mapObj.title.trim().length === 0) {
      errors.push(`Map "${mapKey}" must have a non-empty string title.`);
    }

    if (!mapObj.nodes || typeof mapObj.nodes !== 'object' || Array.isArray(mapObj.nodes)) {
      errors.push(`Map "${mapKey}" has invalid nodes collection.`);
      continue;
    }

    const nodeSet = new Set<UUID>();
    allNodesByMap.set(mapKey, nodeSet);

    for (const [nodeKey, rawNode] of Object.entries(mapObj.nodes as Record<string, unknown>)) {
      if (!isValidUUID(nodeKey)) {
        errors.push(`Node key "${nodeKey}" in map "${mapKey}" is not a valid UUID.`);
        continue;
      }
      if (!rawNode || typeof rawNode !== 'object') {
        errors.push(`Node "${nodeKey}" must be an object.`);
        continue;
      }
      const node = rawNode as Record<string, unknown>;
      if (node.id !== nodeKey) {
        errors.push(`Node key "${nodeKey}" mismatches node.id "${String(node.id)}".`);
      }
      if (node.mapId !== mapKey) {
        errors.push(`Node "${nodeKey}" mapId "${String(node.mapId)}" mismatches parent map "${mapKey}".`);
      }
      if (typeof node.x !== 'number' || !Number.isFinite(node.x)) {
        errors.push(`Node "${nodeKey}" has invalid x coordinate.`);
      }
      if (typeof node.y !== 'number' || !Number.isFinite(node.y)) {
        errors.push(`Node "${nodeKey}" has invalid y coordinate.`);
      }
      if (!Array.isArray(node.blocks)) {
        errors.push(`Node "${nodeKey}" must have a structured blocks array.`);
      }
      if (node.nestedMapId !== null && node.nestedMapId !== undefined) {
        if (!isValidUUID(node.nestedMapId)) {
          errors.push(`Node "${nodeKey}" has invalid nestedMapId.`);
        } else if (!maps[node.nestedMapId]) {
          errors.push(
            `Node "${nodeKey}" references missing nestedMapId "${node.nestedMapId}".`
          );
        }
      }
      nodeSet.add(nodeKey);
    }
  }

  // Pass 2: Validate edge endpoint integrity & cross-map references
  for (const [mapKey, rawMap] of Object.entries(maps)) {
    if (!rawMap || typeof rawMap !== 'object') continue;
    const mapObj = rawMap as Record<string, unknown>;
    const nodeSet = allNodesByMap.get(mapKey) ?? new Set<UUID>();

    if (!mapObj.edges || typeof mapObj.edges !== 'object' || Array.isArray(mapObj.edges)) {
      errors.push(`Map "${mapKey}" has invalid edges collection.`);
      continue;
    }

    for (const [edgeKey, rawEdge] of Object.entries(mapObj.edges as Record<string, unknown>)) {
      if (!isValidUUID(edgeKey)) {
        errors.push(`Edge key "${edgeKey}" in map "${mapKey}" is not a valid UUID.`);
        continue;
      }
      if (!rawEdge || typeof rawEdge !== 'object') {
        errors.push(`Edge "${edgeKey}" must be an object.`);
        continue;
      }
      const edge = rawEdge as Record<string, unknown>;
      if (edge.id !== edgeKey) {
        errors.push(`Edge key "${edgeKey}" mismatches edge.id "${String(edge.id)}".`);
      }
      if (edge.mapId !== mapKey) {
        errors.push(`Edge "${edgeKey}" mapId mismatches parent map "${mapKey}".`);
      }
      if (!isValidUUID(edge.sourceId) || !nodeSet.has(edge.sourceId)) {
        errors.push(
          `Edge "${edgeKey}" has dangling or invalid sourceId "${String(edge.sourceId)}".`
        );
      }
      if (!isValidUUID(edge.targetId) || !nodeSet.has(edge.targetId)) {
        errors.push(
          `Edge "${edgeKey}" has dangling or invalid targetId "${String(edge.targetId)}".`
        );
      }
      if (edge.sourceId === edge.targetId) {
        warnings.push(`Edge "${edgeKey}" is a self-loop on node "${String(edge.sourceId)}".`);
      }
    }

    // Validate cross-map references
    if (mapObj.nodes && typeof mapObj.nodes === 'object') {
      for (const [nodeKey, rawNode] of Object.entries(mapObj.nodes as Record<string, unknown>)) {
        const node = rawNode as Record<string, unknown>;
        if (Array.isArray(node.crossMapRefs)) {
          for (const ref of node.crossMapRefs) {
            if (!ref || typeof ref !== 'object') {
              errors.push(`Node "${nodeKey}" contains malformed crossMapRef.`);
              continue;
            }
            const r = ref as Record<string, unknown>;
            const targetNodes = isValidUUID(r.targetMapId)
              ? allNodesByMap.get(r.targetMapId)
              : undefined;
            if (!targetNodes) {
              errors.push(
                `Node "${nodeKey}" crossMapRef targets nonexistent map "${String(r.targetMapId)}".`
              );
            } else if (!isValidUUID(r.targetNodeId) || !targetNodes.has(r.targetNodeId)) {
              errors.push(
                `Node "${nodeKey}" crossMapRef targets nonexistent node "${String(r.targetNodeId)}".`
              );
            }
          }
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

// ============================================================================
// 5. Repository Abstraction (Decoupled from IndexedDB)
// ============================================================================

export interface MigrationBackupRecord {
  id: string;
  createdAt: string;
  fromVersion: number;
  toVersion: number;
  rawPayload: unknown;
}

export interface WorkspaceRepository {
  loadWorkspace(): Promise<WorkspaceEnvelope | null>;
  saveWorkspace(envelope: WorkspaceEnvelope): Promise<void>;
  saveMigrationBackup(backup: MigrationBackupRecord): Promise<void>;
  listMigrationBackups(): Promise<MigrationBackupRecord[]>;
  saveAttachment(record: BinaryAttachmentRecord): Promise<void>;
  getAttachment(id: UUID): Promise<BinaryAttachmentRecord | null>;
  deleteAttachment(id: UUID): Promise<void>;
  close(): void;
}

// ============================================================================
// 6. IndexedDB Repository Implementation with Clean Lifecycle Management
// ============================================================================

const DB_NAME = 'local_mindmap_db';
const DB_VERSION = 1;
const STORE_WORKSPACE = 'workspace';
const STORE_BACKUPS = 'migration_backups';
const STORE_ATTACHMENTS = 'attachments';
const WORKSPACE_PRIMARY_KEY = 'primary_workspace';

export class IndexedDBWorkspaceRepository implements WorkspaceRepository {
  private db: IDBDatabase | null = null;
  private openPromise: Promise<IDBDatabase> | null = null;
  private closed = false;

  private async getDB(): Promise<IDBDatabase> {
    if (this.closed) {
      this.closed = false;
    }
    if (this.db) {
      return this.db;
    }
    if (this.openPromise) {
      return this.openPromise;
    }

    this.openPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB is unavailable in this environment.'));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE_WORKSPACE)) {
          db.createObjectStore(STORE_WORKSPACE);
        }
        if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
          db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_ATTACHMENTS)) {
          db.createObjectStore(STORE_ATTACHMENTS, { keyPath: 'meta.id' });
        }
      };

      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          this.close();
        };
        db.onclose = () => {
          this.db = null;
          this.openPromise = null;
        };
        this.db = db;
        this.openPromise = null;
        resolve(db);
      };

      request.onerror = () => {
        this.openPromise = null;
        reject(request.error ?? new Error('Failed to open IndexedDB database.'));
      };

      request.onblocked = () => {
        this.openPromise = null;
        reject(new Error('IndexedDB connection blocked by another open tab or connection.'));
      };
    });

    return this.openPromise;
  }

  public close(): void {
    this.closed = true;
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.openPromise = null;
  }

  public async loadWorkspace(): Promise<WorkspaceEnvelope | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readonly');
      const store = tx.objectStore(STORE_WORKSPACE);
      const req = store.get(WORKSPACE_PRIMARY_KEY);

      req.onsuccess = () => resolve((req.result as WorkspaceEnvelope | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read workspace from IndexedDB.'));
    });
  }

  public async saveWorkspace(envelope: WorkspaceEnvelope): Promise<void> {
    const validation = validateWorkspaceEnvelope(envelope);
    if (!validation.valid) {
      throw new Error(`Refusing to persist invalid workspace: ${validation.errors.join('; ')}`);
    }

    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_WORKSPACE, 'readwrite');
      const store = tx.objectStore(STORE_WORKSPACE);
      store.put(envelope, WORKSPACE_PRIMARY_KEY);

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB write transaction failed.'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB write transaction aborted.'));
    });
  }

  public async saveMigrationBackup(backup: MigrationBackupRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BACKUPS, 'readwrite');
      tx.objectStore(STORE_BACKUPS).put(backup);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save migration backup.'));
    });
  }

  public async listMigrationBackups(): Promise<MigrationBackupRecord[]> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_BACKUPS, 'readonly');
      const req = tx.objectStore(STORE_BACKUPS).getAll();
      req.onsuccess = () => resolve((req.result as MigrationBackupRecord[]) ?? []);
      req.onerror = () => reject(req.error ?? new Error('Failed to list migration backups.'));
    });
  }

  public async saveAttachment(record: BinaryAttachmentRecord): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTACHMENTS, 'readwrite');
      tx.objectStore(STORE_ATTACHMENTS).put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to persist attachment binary.'));
    });
  }

  public async getAttachment(id: UUID): Promise<BinaryAttachmentRecord | null> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTACHMENTS, 'readonly');
      const req = tx.objectStore(STORE_ATTACHMENTS).get(id);
      req.onsuccess = () => resolve((req.result as BinaryAttachmentRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read attachment binary.'));
    });
  }

  public async deleteAttachment(id: UUID): Promise<void> {
    const db = await this.getDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTACHMENTS, 'readwrite');
      tx.objectStore(STORE_ATTACHMENTS).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to delete attachment binary.'));
    });
  }
}

// ============================================================================
// 7. In-Memory Repository (For Testing & Fallback Isolation)
// ============================================================================

export class InMemoryWorkspaceRepository implements WorkspaceRepository {
  private workspace: WorkspaceEnvelope | null = null;
  private backups: MigrationBackupRecord[] = [];
  private attachments = new Map<UUID, BinaryAttachmentRecord>();

  public async loadWorkspace(): Promise<WorkspaceEnvelope | null> {
    return this.workspace ? JSON.parse(JSON.stringify(this.workspace)) : null;
  }

  public async saveWorkspace(envelope: WorkspaceEnvelope): Promise<void> {
    const validation = validateWorkspaceEnvelope(envelope);
    if (!validation.valid) {
      throw new Error(`Refusing to persist invalid workspace: ${validation.errors.join('; ')}`);
    }
    this.workspace = JSON.parse(JSON.stringify(envelope));
  }

  public async saveMigrationBackup(backup: MigrationBackupRecord): Promise<void> {
    this.backups.push(JSON.parse(JSON.stringify(backup)));
  }

  public async listMigrationBackups(): Promise<MigrationBackupRecord[]> {
    return JSON.parse(JSON.stringify(this.backups));
  }

  public async saveAttachment(record: BinaryAttachmentRecord): Promise<void> {
    this.attachments.set(record.meta.id, record);
  }

  public async getAttachment(id: UUID): Promise<BinaryAttachmentRecord | null> {
    return this.attachments.get(id) ?? null;
  }

  public async deleteAttachment(id: UUID): Promise<void> {
    this.attachments.delete(id);
  }

  public close(): void {
    // No-op for memory backend
  }
}

// ============================================================================
// 8. Export / Import Helpers with Attachment Serialization
// ============================================================================

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function buildExportBundle(
  envelope: WorkspaceEnvelope,
  repo: WorkspaceRepository
): Promise<ExportedWorkspaceBundle> {
  const embeddedAttachments: Record<UUID, { meta: AttachmentMeta; base64Data: string }> = {};
  for (const attId of Object.keys(envelope.attachments)) {
    const rec = await repo.getAttachment(attId);
    if (rec) {
      embeddedAttachments[attId] = {
        meta: rec.meta,
        base64Data: arrayBufferToBase64(rec.data),
      };
    }
  }

  return {
    envelope: {
      ...envelope,
      exportedAt: new Date().toISOString(),
    },
    embeddedAttachments,
  };
}

export async function parseAndValidateImport(
  rawJsonText: string,
  repo: WorkspaceRepository
): Promise<{
  envelope: WorkspaceEnvelope;
  migratedFrom?: number;
  warnings: string[];
}> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJsonText);
  } catch {
    throw new Error('Malformed JSON file: unable to parse syntax.');
  }

  const migrationResult = migrateWorkspacePayload(parsed);

  // Preserve pre-migration snapshot safely in backup store before accepting
  if (migrationResult.migrated && migrationResult.backupSnapshot !== undefined) {
    await repo.saveMigrationBackup({
      id: generateUUID(),
      createdAt: new Date().toISOString(),
      fromVersion: migrationResult.fromVersion,
      toVersion: migrationResult.toVersion,
      rawPayload: migrationResult.backupSnapshot,
    });
  }

  const validation = validateWorkspaceEnvelope(migrationResult.envelope);
  if (!validation.valid) {
    throw new Error(`Validation failed:\n- ${validation.errors.join('\n- ')}`);
  }

  // Restore embedded binary attachments if present
  if (
    parsed &&
    typeof parsed === 'object' &&
    'embeddedAttachments' in parsed &&
    parsed.embeddedAttachments &&
    typeof parsed.embeddedAttachments === 'object'
  ) {
    const embedded = parsed.embeddedAttachments as Record<
      string,
      { meta: AttachmentMeta; base64Data: string }
    >;
    for (const [attId, item] of Object.entries(embedded)) {
      if (isValidUUID(attId) && item?.meta && typeof item.base64Data === 'string') {
        await repo.saveAttachment({
          meta: item.meta,
          data: base64ToArrayBuffer(item.base64Data),
        });
      }
    }
  }

  return {
    envelope: migrationResult.envelope,
    migratedFrom: migrationResult.migrated ? migrationResult.fromVersion : undefined,
    warnings: validation.warnings,
  };
}

// ============================================================================
// 9. Markdown / Plain-Text Outline Importer
// ============================================================================

export function parseMarkdownOutlineToNodes(
  rawText: string,
  mapId: UUID,
  originX: number,
  originY: number,
  defaultColor: string,
  defaultTextColor: string
): { nodes: Record<UUID, GraphNode>; edges: Record<UUID, GraphEdge> } {
  const lines = rawText.split(/\r?\n/);
  const nodes: Record<UUID, GraphNode> = {};
  const edges: Record<UUID, GraphEdge> = {};
  const now = new Date().toISOString();

  interface OutlineItem {
    level: number;
    title: string;
    bodyLines: string[];
  }

  const items: OutlineItem[] = [];
  let current: OutlineItem | null = null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    const bulletMatch = rawLine.match(/^(\s*)[-*+]\s+(.+)$/);

    if (headingMatch) {
      if (current) items.push(current);
      current = {
        level: headingMatch[1].length - 1,
        title: headingMatch[2].trim(),
        bodyLines: [],
      };
    } else if (bulletMatch) {
      if (current) items.push(current);
      const indent = Math.floor(bulletMatch[1].length / 2);
      current = {
        level: indent + 1,
        title: bulletMatch[2].trim(),
        bodyLines: [],
      };
    } else {
      if (!current) {
        current = { level: 0, title: trimmed.slice(0, 60), bodyLines: [] };
      } else {
        current.bodyLines.push(trimmed);
      }
    }
  }
  if (current) items.push(current);

  if (items.length === 0) {
    const id = generateUUID();
    nodes[id] = {
      id,
      mapId,
      title: 'Imported Note',
      x: Math.round(originX),
      y: Math.round(originY),
      width: 260,
      height: 130,
      color: defaultColor,
      collapsed: false,
      blocks: createStructuredBlocksFromPlainText(rawText),
      nestedMapId: null,
      attachmentIds: [],
      crossMapRefs: [],
      metadata: {
        createdAt: now,
        updatedAt: now,
        owner: 'user',
        tags: defaultTextColor !== '#f8fafc' ? [`text:${defaultTextColor}`] : [],
        deletedAt: null,
      },
    };
    return { nodes, edges };
  }

  const parentStack: { level: number; id: UUID }[] = [];
  const levelCounts = new Map<number, number>();

  items.forEach((item) => {
    const id = generateUUID();
    const rowIdx = levelCounts.get(item.level) ?? 0;
    levelCounts.set(item.level, rowIdx + 1);

    const x = Math.round(originX + item.level * 310);
    const y = Math.round(originY + rowIdx * 165);

    nodes[id] = {
      id,
      mapId,
      title: item.title || 'Untitled',
      x,
      y,
      width: 250,
      height: 120,
      color: defaultColor,
      collapsed: false,
      blocks: createStructuredBlocksFromPlainText(item.bodyLines.join('\n')),
      nestedMapId: null,
      attachmentIds: [],
      crossMapRefs: [],
      metadata: {
        createdAt: now,
        updatedAt: now,
        owner: 'user',
        tags: defaultTextColor !== '#f8fafc' ? [`text:${defaultTextColor}`] : [],
        deletedAt: null,
      },
    };

    while (parentStack.length > 0 && parentStack[parentStack.length - 1].level >= item.level) {
      parentStack.pop();
    }
    if (parentStack.length > 0) {
      const parentId = parentStack[parentStack.length - 1].id;
      const edgeId = generateUUID();
      edges[edgeId] = {
        id: edgeId,
        mapId,
        sourceId: parentId,
        targetId: id,
        label: '',
        style: 'solid',
        directed: true,
        metadata: {
          createdAt: now,
          updatedAt: now,
          owner: 'user',
          deletedAt: null,
        },
      };
    }
    parentStack.push({ level: item.level, id });
  });

  return { nodes, edges };
}

// ============================================================================
// 10. Hierarchy Depth & Parent Color Gradient Helpers
// ============================================================================

export function getNodeHierarchyDepth(nodeId: UUID, map: MindMapDocument): number {
  // Find incoming edges to determine depth from roots
  const incoming = new Map<UUID, UUID[]>();
  Object.values(map.edges).forEach((e) => {
    if (e.metadata.deletedAt) return;
    const list = incoming.get(e.targetId) ?? [];
    list.push(e.sourceId);
    incoming.set(e.targetId, list);
  });

  let maxDepth = 0;
  const visited = new Set<UUID>();

  function dfs(currId: UUID, currentDepth: number): number {
    if (visited.has(currId)) return currentDepth;
    visited.add(currId);
    const parents = incoming.get(currId);
    if (!parents || parents.length === 0) return currentDepth;
    let deepest = currentDepth;
    for (const pId of parents) {
      deepest = Math.max(deepest, dfs(pId, currentDepth + 1));
    }
    visited.delete(currId);
    return deepest;
  }

  maxDepth = dfs(nodeId, 0);
  return maxDepth;
}

export function deriveChildColor(parentColor: string): string {
  if (!parentColor || parentColor === 'transparent') return '#2b3a4a';
  // Parse hex color
  let hex = parentColor.replace('#', '');
  if (hex.length === 3) {
    hex = hex.split('').map((c) => c + c).join('');
  }
  const num = parseInt(hex, 16);
  if (isNaN(num)) return '#2b3a4a';

  let r = (num >> 16) & 255;
  let g = (num >> 8) & 255;
  let b = num & 255;

  // Shift color towards a richer child gradient shade (e.g., blend slightly or adjust lightness)
  r = Math.min(255, Math.max(0, Math.round(r * 0.88 + 25)));
  g = Math.min(255, Math.max(0, Math.round(g * 0.88 + 35)));
  b = Math.min(255, Math.max(0, Math.round(b * 0.88 + 45)));

  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}
