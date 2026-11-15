import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AttachmentMeta,
  ContentBlock,
  GraphEdge,
  GraphNode,
  MindMapDocument,
  SaveStatus,
  UUID,
  WorkspaceEnvelope,
} from './types';
import {
  IndexedDBWorkspaceRepository,
  buildExportBundle,
  createSeedWorkspace,
  createStructuredBlocksFromPlainText,
  deriveChildColor,
  generateUUID,
  getNodeHierarchyDepth,
  migrateWorkspacePayload,
  parseAndValidateImport,
  parseMarkdownOutlineToNodes,
  serializeBlocksToPlainText,
  validateWorkspaceEnvelope,
} from './storage';
import { QuadTreeNode } from './spatial';

// Common editor themes with full canvas/surface/text/edge color palettes
export interface EditorThemePreset {
  id: string;
  name: string;
  bgCanvas: string;
  topbarBg: string;
  topbarBorder: string;
  surface: string;
  surfaceElevated: string;
  border: string;
  textMain: string;
  textMuted: string;
  primary: string;
  primaryBg: string;
  edgeColor: string;
  nodeTextColor: string;
  defaultNodeBg: string;
}

const EDITOR_THEMES: EditorThemePreset[] = [
  {
    id: 'dark',
    name: 'Dark (OrgPad)',
    bgCanvas: '#1c1d1f',
    topbarBg: '#26292e',
    topbarBorder: '#34383f',
    surface: '#25282e',
    surfaceElevated: '#2f333b',
    border: '#3f444e',
    textMain: '#f1f5f9',
    textMuted: '#94a3b8',
    primary: '#60a5fa',
    primaryBg: '#2563eb',
    edgeColor: '#7ca1cc',
    nodeTextColor: '#f8fafc',
    defaultNodeBg: '#2b3a4a',
  },
  {
    id: 'monokai',
    name: 'Monokai',
    bgCanvas: '#272822',
    topbarBg: '#1e1f1c',
    topbarBorder: '#3e3d32',
    surface: '#2d2e27',
    surfaceElevated: '#383930',
    border: '#49483e',
    textMain: '#f8f8f2',
    textMuted: '#a6a28c',
    primary: '#a6e22e',
    primaryBg: '#679c0e',
    edgeColor: '#66d9ef',
    nodeTextColor: '#f8f8f2',
    defaultNodeBg: '#3e3d32',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    bgCanvas: '#282a36',
    topbarBg: '#21222c',
    topbarBorder: '#44475a',
    surface: '#2f3241',
    surfaceElevated: '#3a3d4e',
    border: '#44475a',
    textMain: '#f8f8f2',
    textMuted: '#9ea8c7',
    primary: '#bd93f9',
    primaryBg: '#7c4dff',
    edgeColor: '#8be9fd',
    nodeTextColor: '#f8f8f2',
    defaultNodeBg: '#383a59',
  },
  {
    id: 'nord',
    name: 'Nord',
    bgCanvas: '#2e3440',
    topbarBg: '#242933',
    topbarBorder: '#3b4252',
    surface: '#3b4252',
    surfaceElevated: '#434c5e',
    border: '#4c566a',
    textMain: '#eceff4',
    textMuted: '#d8dee9',
    primary: '#88c0d0',
    primaryBg: '#5e81ac',
    edgeColor: '#81a1c1',
    nodeTextColor: '#eceff4',
    defaultNodeBg: '#3b4252',
  },
  {
    id: 'solarized-dark',
    name: 'Solarized Dark',
    bgCanvas: '#002b36',
    topbarBg: '#073642',
    topbarBorder: '#0e4959',
    surface: '#073642',
    surfaceElevated: '#0b4453',
    border: '#1c5a6b',
    textMain: '#eee8d5',
    textMuted: '#93a1a1',
    primary: '#2aa198',
    primaryBg: '#268bd2',
    edgeColor: '#2aa198',
    nodeTextColor: '#fdf6e3',
    defaultNodeBg: '#073642',
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    bgCanvas: '#f6f8fa',
    topbarBg: '#ffffff',
    topbarBorder: '#d0d7de',
    surface: '#ffffff',
    surfaceElevated: '#f3f4f6',
    border: '#d0d7de',
    textMain: '#1f2328',
    textMuted: '#59636e',
    primary: '#0969da',
    primaryBg: '#0969da',
    edgeColor: '#57606a',
    nodeTextColor: '#1f2328',
    defaultNodeBg: '#ffffff',
  },
];

// Card Background Color Palette
const NODE_BG_COLORS = [
  { name: 'Steel Blue', value: '#2b3a4a' },
  { name: 'Muted Mauve', value: '#4a323b' },
  { name: 'Sage Olive', value: '#354434' },
  { name: 'Deep Indigo', value: '#343652' },
  { name: 'Warm Amber', value: '#4a3d28' },
  { name: 'Charcoal', value: '#26292e' },
  { name: 'Monokai Olive', value: '#3e3d32' },
  { name: 'Soft Paper', value: '#f8fafc' },
  { name: 'Transparent Icon', value: 'transparent' },
];

// Card Text Color Palette
const NODE_TEXT_COLORS = [
  { name: 'Snow White', value: '#f8fafc' },
  { name: 'Monokai Cream', value: '#f8f8f2' },
  { name: 'Soft Cyan', value: '#7dd3fc' },
  { name: 'Mint Green', value: '#86efac' },
  { name: 'Warm Gold', value: '#fde047' },
  { name: 'Rose Pink', value: '#fda4af' },
  { name: 'Ink Slate', value: '#0f172a' },
];

const NODE_ICONS = [
  { id: '', label: 'Card' },
  { id: 'brain', label: 'Brain' },
  { id: 'book', label: 'Reader' },
  { id: 'idea', label: 'Idea' },
  { id: 'hub', label: 'Hub' },
];

const MAX_HISTORY = 60;

interface DragSession {
  nodeId: UUID;
  nodeIds: UUID[];
  startMouseX: number;
  startMouseY: number;
  initialPositions: Record<UUID, { x: number; y: number }>;
  snapshotBeforeDrag: WorkspaceEnvelope;
  moved: boolean;
}

interface PanSession {
  startMouseX: number;
  startMouseY: number;
  initialPanX: number;
  initialPanY: number;
}

interface LinkDragSession {
  sourceNodeId: UUID;
  currentWorldX: number;
  currentWorldY: number;
  hoverTargetNodeId: UUID | null;
}

interface CanvasContextMenu {
  screenX: number;
  screenY: number;
  worldX: number;
  worldY: number;
  targetNodeId?: UUID;
  targetEdgeId?: UUID;
}

function cloneEnvelope(env: WorkspaceEnvelope): WorkspaceEnvelope {
  return structuredClone ? structuredClone(env) : JSON.parse(JSON.stringify(env));
}

function renderNodeGlyph(iconTag?: string) {
  switch (iconTag) {
    case 'brain':
      return (
        <svg className="node-glyph-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M24 10c-4.5 0-8 3-8 7.2-3.2.8-5.5 3.6-5.5 7 0 2.7 1.4 5 3.6 6.3-.3 1-.4 2-.4 3 0 4.4 3.6 8 8 8h2.3V10z" />
          <path d="M24 10c4.5 0 8 3 8 7.2 3.2.8 5.5 3.6 5.5 7 0 2.7-1.4 5-3.6 6.3.3 1 .4 2 .4 3 0 4.4-3.6 8-8 8h-2.3V10z" />
          <path d="M16 21c2.5 0 4 1.5 4 3.5M32 21c-2.5 0-4 1.5-4 3.5M17 31c2-1 4.5-1 6.5.5M31 31c-2-1-4.5-1-6.5.5" />
        </svg>
      );
    case 'book':
      return (
        <svg className="node-glyph-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="24" cy="13" r="4.5" />
          <path d="M15 24c0-3.5 4-6 9-6s9 2.5 9 6" />
          <path d="M11 26l13 4 13-4v12l-13 4-13-4V26z" />
          <path d="M24 30v12" />
        </svg>
      );
    case 'idea':
      return (
        <svg className="node-glyph-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M24 9a10 10 0 0 0-6 18c1.5 1.2 2.2 2.6 2.5 4h7c.3-1.4 1-2.8 2.5-4a10 10 0 0 0-6-18z" />
          <path d="M20 35h8M21 39h6" />
        </svg>
      );
    case 'hub':
      return (
        <svg className="node-glyph-svg" viewBox="0 0 48 48" fill="none" stroke="currentColor" strokeWidth="1.8">
          <circle cx="24" cy="24" r="5" />
          <circle cx="11" cy="14" r="3" />
          <circle cx="37" cy="14" r="3" />
          <circle cx="11" cy="34" r="3" />
          <circle cx="37" cy="34" r="3" />
          <path d="M13.5 16l6.5 5M34.5 16l-6.5 5M13.5 32l6.5-5M34.5 32l-6.5-5" />
        </svg>
      );
    default:
      return null;
  }
}

function renderContentBlocks(blocks: ContentBlock[]) {
  return blocks.map((block) => {
    const children = block.spans.map((span, i) => {
      let el: React.ReactNode = span.text;
      if (span.code) el = <code key={i}>{el}</code>;
      if (span.italic) el = <em key={i}>{el}</em>;
      if (span.bold) el = <strong key={i}>{el}</strong>;
      return <React.Fragment key={i}>{el}</React.Fragment>;
    });

    if (block.type === 'heading') {
      return (
        <div key={block.id} className="block-heading">
          {children}
        </div>
      );
    }
    if (block.type === 'bullet') {
      return (
        <div key={block.id} className="block-bullet">
          <span className="bullet-dot">•</span>
          <span>{children}</span>
        </div>
      );
    }
    if (block.type === 'quote') {
      return (
        <blockquote key={block.id} className="block-quote">
          {children}
        </blockquote>
      );
    }
    return (
      <p key={block.id} className="block-paragraph">
        {children}
      </p>
    );
  });
}

// Smart semantic edge routing & bundling: smooth cubic Bezier curves with parallel-edge separation & obstacle avoidance
function computeSmartEdgePath(
  sx: number,
  sy: number,
  tx: number,
  ty: number,
  bundleIndex: number,
  bundleCount: number,
  obstacles: { id: string; cx: number; cy: number; hw: number; hh: number }[],
  srcId: string,
  tgtId: string,
  zoom: number
) {
  const dx = tx - sx;
  const dy = ty - sy;
  const dist = Math.hypot(dx, dy) || 1;
  const nx = -dy / dist;
  const ny = dx / dist;

  const spread = bundleCount > 1 ? (bundleIndex - (bundleCount - 1) / 2) * 34 * zoom : 0;

  let obstacleOffset = 0;
  for (const obs of obstacles) {
    if (obs.id === srcId || obs.id === tgtId) continue;
    const tProj = ((obs.cx - sx) * dx + (obs.cy - sy) * dy) / (dist * dist);
    if (tProj > 0.12 && tProj < 0.88) {
      const closestX = sx + tProj * dx;
      const closestY = sy + tProj * dy;
      const signedPerp = (obs.cx - closestX) * nx + (obs.cy - closestY) * ny;
      const clearance = Math.max(obs.hw, obs.hh) + 28 * zoom;
      if (Math.abs(signedPerp) < clearance) {
        const pushDir = signedPerp >= 0 ? -1 : 1;
        const needed = pushDir * (clearance - Math.abs(signedPerp) + 22 * zoom);
        if (Math.abs(needed) > Math.abs(obstacleOffset)) {
          obstacleOffset = needed;
        }
      }
    }
  }

  const totalOffset = spread + obstacleOffset;
  const handleLen = Math.min(dist * 0.35, 140 * zoom);

  const horizDominant = Math.abs(dx) >= Math.abs(dy);
  const c1x = (horizDominant ? sx + Math.sign(dx || 1) * handleLen : sx) + nx * totalOffset;
  const c1y = (horizDominant ? sy : sy + Math.sign(dy || 1) * handleLen) + ny * totalOffset;
  const c2x = (horizDominant ? tx - Math.sign(dx || 1) * handleLen : tx) + nx * totalOffset;
  const c2y = (horizDominant ? ty : ty - Math.sign(dy || 1) * handleLen) + ny * totalOffset;

  const midX = 0.125 * sx + 0.375 * c1x + 0.375 * c2x + 0.125 * tx;
  const midY = 0.125 * sy + 0.375 * c1y + 0.375 * c2y + 0.125 * ty;

  return {
    d: `M ${sx.toFixed(1)} ${sy.toFixed(1)} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${tx.toFixed(1)} ${ty.toFixed(1)}`,
    midX,
    midY,
  };
}

// Compute exact intersection of a line from center (sx, sy) -> (tx, ty) with target card rectangle
function getRectEdgePoint(
  cx: number,
  cy: number,
  w: number,
  h: number,
  fromX: number,
  fromY: number,
  pad = 4
) {
  const dx = cx - fromX;
  const dy = cy - fromY;
  const dist = Math.hypot(dx, dy) || 1;
  const ux = dx / dist;
  const uy = dy / dist;
  const halfW = w / 2 + pad;
  const halfH = h / 2 + pad;
  const scaleX = ux !== 0 ? Math.abs(halfW / ux) : Infinity;
  const scaleY = uy !== 0 ? Math.abs(halfH / uy) : Infinity;
  const t = Math.min(scaleX, scaleY, dist);
  return {
    x: cx - ux * t,
    y: cy - uy * t,
  };
}

export default function App() {
  const repoRef = useRef<IndexedDBWorkspaceRepository | null>(null);
  if (!repoRef.current) {
    repoRef.current = new IndexedDBWorkspaceRepository();
  }

  // Workspace state & Undo/Redo history stacks
  const [workspace, setWorkspace] = useState<WorkspaceEnvelope | null>(null);
  const [past, setPast] = useState<WorkspaceEnvelope[]>([]);
  const [future, setFuture] = useState<WorkspaceEnvelope[]>([]);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ state: 'idle' });
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'info' | 'error' | 'success';
    text: string;
  } | null>(null);

  // Editor Theme, Custom Palette & Autosave State (persisted to localStorage)
  const [autosaveEnabled, setAutosaveEnabled] = useState<boolean>(() => {
    const saved = localStorage.getItem('localorga_autosave');
    return saved === null ? true : saved === 'true';
  });
  const [themeId, setThemeId] = useState<string>(
    () => localStorage.getItem('localorga_theme') || 'dark'
  );
  const [customCanvasBg, setCustomCanvasBg] = useState<string | null>(
    () => localStorage.getItem('localorga_canvas_bg') || null
  );
  const [defaultCardBg, setDefaultCardBg] = useState<string>(
    () => localStorage.getItem('localorga_card_bg') || '#2b3a4a'
  );
  const [defaultCardText, setDefaultCardText] = useState<string>(
    () => localStorage.getItem('localorga_card_text') || '#f8fafc'
  );

  useEffect(() => {
    localStorage.setItem('localorga_autosave', String(autosaveEnabled));
    localStorage.setItem('localorga_theme', themeId);
    if (customCanvasBg) localStorage.setItem('localorga_canvas_bg', customCanvasBg);
    else localStorage.removeItem('localorga_canvas_bg');
    localStorage.setItem('localorga_card_bg', defaultCardBg);
    localStorage.setItem('localorga_card_text', defaultCardText);
  }, [autosaveEnabled, themeId, customCanvasBg, defaultCardBg, defaultCardText]);

  // UI modes: Edit vs Present, Search, Right Settings/Organisation Drawer
  const [presentMode, setPresentMode] = useState<boolean>(false);
  const [rightPanelOpen, setRightPanelOpen] = useState<boolean>(false);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewportSize, setViewportSize] = useState<{ w: number; h: number }>({
    w: typeof window !== 'undefined' ? window.innerWidth : 1440,
    h: typeof window !== 'undefined' ? window.innerHeight : 900,
  });

  // Graph Engine interaction state
  const [selectedNodeId, setSelectedNodeId] = useState<UUID | null>(null);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<UUID>>(new Set());
  const [marquee, setMarquee] = useState<{ x1: number; y1: number; x2: number; y2: number } | null>(null);
  const marqueeStartRef = useRef<{ startX: number; startY: number } | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<UUID | null>(null);
  const [connectMode, setConnectMode] = useState<boolean>(false);
  const [connectSourceId, setConnectSourceId] = useState<UUID | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<UUID | null>(null);
  const [editingDraftText, setEditingDraftText] = useState<string>('');
  const [editingDraftTitle, setEditingDraftTitle] = useState<string>('');
  const [editingEdgeId, setEditingEdgeId] = useState<UUID | null>(null);
  const [edgeLabelDraft, setEdgeLabelDraft] = useState<string>('');

  // Cross-map reference picker state
  const [refTargetMapId, setRefTargetMapId] = useState<UUID>('');
  const [refTargetNodeId, setRefTargetNodeId] = useState<UUID>('');
  const [refLabel, setRefLabel] = useState<string>('');

  // Navigation history stack for backtracking
  const [navHistory, setNavHistory] = useState<UUID[]>([]);

  // Mouse-driven connection drag & right-click context menu state
  const [linkDrag, setLinkDrag] = useState<LinkDragSession | null>(null);
  const [contextMenu, setContextMenu] = useState<CanvasContextMenu | null>(null);
  const [isDraggingFile, setIsDraggingFile] = useState<boolean>(false);

  // Direct DOM refs for 60fps zero-re-render dragging & panning
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const nodeDomRefs = useRef<Map<UUID, HTMLDivElement>>(new Map());
  const [measuredNodeBoxes, setMeasuredNodeBoxes] = useState<Record<UUID, { width: number; height: number }>>({});
  const dragSessionRef = useRef<DragSession | null>(null);
  const panSessionRef = useRef<PanSession | null>(null);
  const linkDragRef = useRef<LinkDragSession | null>(null);
  const rafPendingRef = useRef<number | null>(null);
  const fileImportInputRef = useRef<HTMLInputElement | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);

  const activeTheme = useMemo(
    () => EDITOR_THEMES.find((t) => t.id === themeId) ?? EDITOR_THEMES[0],
    [themeId]
  );

  // Track window resize for accurate viewport culling
  useEffect(() => {
    const onResize = () => setViewportSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  // ==========================================================================
  // Initialization & Clean DB Lifecycle
  // ==========================================================================
  useEffect(() => {
    let active = true;
    const repo = repoRef.current!;

    async function init() {
      try {
        const stored = await repo.loadWorkspace();
        if (!active) return;

        if (!stored) {
          const seed = createSeedWorkspace();
          const seedMaps = Object.values(seed.maps);
          if (seedMaps[0]) {
            const nodes = Object.values(seedMaps[0].nodes);
            if (nodes[0]) nodes[0].color = '#2b3a4a';
            if (nodes[1] && nodes[0]) {
              const c1 = deriveChildColor(nodes[0].color);
              nodes[1].color = c1;
              nodes[1].metadata.tags.push(`parentColor:${nodes[0].color}`);
            }
            if (nodes[2] && nodes[0]) {
              const c2 = deriveChildColor(nodes[0].color);
              nodes[2].color = c2;
              nodes[2].metadata.tags.push(`parentColor:${nodes[0].color}`);
            }
          }
          await repo.saveWorkspace(seed);
          setWorkspace(seed);
          setSaveStatus({ state: 'saved', timestamp: new Date().toLocaleTimeString() });
        } else {
          const migration = migrateWorkspacePayload(stored);
          if (migration.migrated && migration.backupSnapshot !== undefined) {
            await repo.saveMigrationBackup({
              id: generateUUID(),
              createdAt: new Date().toISOString(),
              fromVersion: migration.fromVersion,
              toVersion: migration.toVersion,
              rawPayload: migration.backupSnapshot,
            });
            setBannerMessage({
              type: 'info',
              text: `Workspace migrated from schema v${migration.fromVersion} to v${migration.toVersion}.`,
            });
          }

          const check = validateWorkspaceEnvelope(migration.envelope);
          if (!check.valid) {
            setSaveStatus({
              state: 'error',
              message: `Stored workspace validation error: ${check.errors[0]}`,
              timestamp: new Date().toLocaleTimeString(),
            });
            setWorkspace(createSeedWorkspace());
          } else {
            if (migration.migrated) {
              await repo.saveWorkspace(migration.envelope);
            }
            setWorkspace(migration.envelope);
            setSaveStatus({ state: 'saved', timestamp: new Date().toLocaleTimeString() });
          }
        }
      } catch (err) {
        if (!active) return;
        const msg = err instanceof Error ? err.message : 'Unknown database initialization error';
        setSaveStatus({
          state: 'error',
          message: msg,
          timestamp: new Date().toLocaleTimeString(),
        });
        setWorkspace(createSeedWorkspace());
      } finally {
        isInitialLoadRef.current = false;
      }
    }

    init();

    const handleBeforeUnload = () => repo.close();
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      active = false;
      window.removeEventListener('beforeunload', handleBeforeUnload);
      repo.close();
    };
  }, []);

  // ==========================================================================
  // Debounced Live Auto-save (Workspace + In-Progress Card Edits + Tab Flush)
  // ==========================================================================
  useEffect(() => {
    if (!workspace || isInitialLoadRef.current || !autosaveEnabled) return;
    const repo = repoRef.current!;

    setSaveStatus({ state: 'saving' });
    const timer = window.setTimeout(async () => {
      try {
        const payloadToSave = cloneEnvelope(workspace);
        if (editingNodeId && payloadToSave.maps[payloadToSave.activeMapId]?.nodes[editingNodeId]) {
          const activeNode = payloadToSave.maps[payloadToSave.activeMapId].nodes[editingNodeId];
          activeNode.title = editingDraftTitle.trim();
          activeNode.blocks = createStructuredBlocksFromPlainText(editingDraftText);
          activeNode.metadata.updatedAt = new Date().toISOString();
        }
        await repo.saveWorkspace(payloadToSave);
        setSaveStatus({ state: 'saved', timestamp: new Date().toLocaleTimeString() });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to save workspace to IndexedDB';
        setSaveStatus({
          state: 'error',
          message,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    }, 400);

    return () => window.clearTimeout(timer);
  }, [workspace, autosaveEnabled, editingNodeId, editingDraftTitle, editingDraftText]);

  const forceManualSave = useCallback(async () => {
    if (!workspace) return;
    setSaveStatus({ state: 'saving' });
    try {
      await repoRef.current!.saveWorkspace(workspace);
      setSaveStatus({ state: 'saved', timestamp: new Date().toLocaleTimeString() });
      setBannerMessage({ type: 'success', text: 'Workspace persisted to IndexedDB.' });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Manual save failed';
      setSaveStatus({ state: 'error', message, timestamp: new Date().toLocaleTimeString() });
    }
  }, [workspace]);

  // ==========================================================================
  // State Mutation & Undo/Redo Engine
  // ==========================================================================
  const commitMutation = useCallback(
    (mutator: (draft: WorkspaceEnvelope) => void, recordHistory = true) => {
      setWorkspace((prev) => {
        if (!prev) return prev;
        if (recordHistory) {
          setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), cloneEnvelope(prev)]);
          setFuture([]);
        }
        const next = cloneEnvelope(prev);
        mutator(next);
        const activeMap = next.maps[next.activeMapId];
        if (activeMap) {
          activeMap.metadata.updatedAt = new Date().toISOString();
        }
        return next;
      });
    },
    []
  );

  const setSingleSelection = useCallback((id: UUID | null) => {
    setSelectedNodeId(id);
    setSelectedNodeIds(id ? new Set([id]) : new Set());
  }, []);

  const toggleNodeSelection = useCallback((id: UUID) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      const arr = Array.from(next);
      setSelectedNodeId(arr.length ? arr[arr.length - 1] : null);
      return next;
    });
  }, []);

  const applyColorToSelection = useCallback(
    (mutator: (node: GraphNode) => void) => {
      const ids =
        selectedNodeIds.size > 0
          ? selectedNodeIds
          : selectedNodeId
          ? new Set<UUID>([selectedNodeId])
          : new Set<UUID>();
      if (ids.size === 0) return;
      commitMutation((draft) => {
        const map = draft.maps[draft.activeMapId];
        for (const id of ids) {
          const n = map.nodes[id];
          if (n) mutator(n);
        }
      });
    },
    [selectedNodeIds, selectedNodeId, commitMutation]
  );



  const undo = useCallback(() => {
    setPast((prevPast) => {
      if (prevPast.length === 0 || !workspace) return prevPast;
      const previous = prevPast[prevPast.length - 1];
      setFuture((f) => [cloneEnvelope(workspace), ...f.slice(0, MAX_HISTORY - 1)]);
      setWorkspace(previous);
      setEditingNodeId(null);
      return prevPast.slice(0, -1);
    });
  }, [workspace]);

  const redo = useCallback(() => {
    setFuture((prevFuture) => {
      if (prevFuture.length === 0 || !workspace) return prevFuture;
      const next = prevFuture[0];
      setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), cloneEnvelope(workspace)]);
      setWorkspace(next);
      setEditingNodeId(null);
      return prevFuture.slice(1);
    });
  }, [workspace]);

  const activeMap: MindMapDocument | null = useMemo(() => {
    if (!workspace) return null;
    return workspace.maps[workspace.activeMapId] ?? Object.values(workspace.maps)[0] ?? null;
  }, [workspace]);

  const allActiveNodes = useMemo(() => {
    if (!activeMap) return [];
    return Object.values(activeMap.nodes)
      .filter((n) => !n.metadata.deletedAt)
      .sort((a, b) => (a.y === b.y ? a.x - b.x : a.y - b.y));
  }, [activeMap]);

  const getEffectiveNodeSize = useCallback(
    (n: GraphNode) => {
      const isIcon =
        Boolean(n.metadata.tags.find((t) => t.startsWith('icon:'))) && n.color === 'transparent';
      if (isIcon) {
        return { width: 120, height: 90 };
      }
      const measured = measuredNodeBoxes[n.id];
      return {
        width: measured ? Math.max(n.width, measured.width) : n.width,
        height: measured ? Math.max(84, measured.height) : n.height,
      };
    },
    [measuredNodeBoxes]
  );

  // Measure actual rendered DOM dimensions of every card so edges never overlap long text
  useEffect(() => {
    if (!activeMap) return;
    const z = activeMap.viewport.zoom || 1;
    let changed = false;
    const nextBoxes: Record<UUID, { width: number; height: number }> = { ...measuredNodeBoxes };

    for (const n of culledNodes) {
      const el = nodeDomRefs.current.get(n.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const worldW = Math.round(rect.width / z);
        const worldH = Math.round(rect.height / z);
        const prev = nextBoxes[n.id];
        if (!prev || Math.abs(prev.width - worldW) > 1 || Math.abs(prev.height - worldH) > 1) {
          nextBoxes[n.id] = { width: worldW, height: worldH };
          changed = true;
        }
      }
    }

    if (changed) {
      setMeasuredNodeBoxes(nextBoxes);
    }
  });

  // Spatial Quadtree Index: O(log n) insertion & range queries for large graphs
  const spatialIndex = useMemo(() => {
    if (!activeMap || allActiveNodes.length === 0) return null;
    let minX = -4000;
    let minY = -4000;
    let maxX = 12000;
    let maxY = 12000;
    for (const n of allActiveNodes) {
      if (n.x < minX) minX = n.x - 1000;
      if (n.y < minY) minY = n.y - 1000;
      if (n.x + n.width > maxX) maxX = n.x + n.width + 1000;
      if (n.y + n.height > maxY) maxY = n.y + n.height + 1000;
    }
    const tree = new QuadTreeNode(
      { x: minX, y: minY, width: maxX - minX, height: maxY - minY, id: 'root' },
      6
    );
    for (const n of allActiveNodes) {
      tree.insert({
        id: n.id,
        x: n.x,
        y: n.y,
        width: n.width,
        height: n.collapsed ? 42 : n.height,
      });
    }
    return tree;
  }, [activeMap, allActiveNodes]);

  // Viewport Culling powered by O(log n) Spatial Quadtree range query
  const culledNodes = useMemo(() => {
    if (!activeMap) return [];
    const { panX, panY, zoom } = activeMap.viewport;
    const margin = 450;
    const minWorldX = (-panX - margin) / zoom;
    const minWorldY = (-panY - margin) / zoom;
    const maxWorldX = (-panX + viewportSize.w + margin) / zoom;
    const maxWorldY = (-panY + viewportSize.h + margin) / zoom;

    const visibleIds = new Set<UUID>();
    if (selectedNodeId) visibleIds.add(selectedNodeId);
    if (editingNodeId) visibleIds.add(editingNodeId);
    if (connectSourceId) visibleIds.add(connectSourceId);

    if (spatialIndex) {
      const hits = spatialIndex.queryRange({
        id: 'viewport',
        x: minWorldX,
        y: minWorldY,
        width: maxWorldX - minWorldX,
        height: maxWorldY - minWorldY,
      });
      for (const h of hits) {
        visibleIds.add(h.id);
      }
    }

    return allActiveNodes.filter((n) => visibleIds.has(n.id));
  }, [activeMap, allActiveNodes, spatialIndex, viewportSize, selectedNodeId, editingNodeId, connectSourceId]);

  // Interactive Minimap Radar bounds & viewport projection
  const minimapData = useMemo(() => {
    if (!activeMap) return null;
    const { panX, panY, zoom } = activeMap.viewport;
    const viewWorldX = -panX / zoom;
    const viewWorldY = -panY / zoom;
    const viewWorldW = viewportSize.w / zoom;
    const viewWorldH = viewportSize.h / zoom;

    let minX = viewWorldX;
    let minY = viewWorldY;
    let maxX = viewWorldX + viewWorldW;
    let maxY = viewWorldY + viewWorldH;

    for (const n of allActiveNodes) {
      const nh = n.collapsed ? 38 : n.height;
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + n.width > maxX) maxX = n.x + n.width;
      if (n.y + nh > maxY) maxY = n.y + nh;
    }

    const pad = 260;
    minX -= pad;
    minY -= pad;
    maxX += pad;
    maxY += pad;

    const worldW = Math.max(800, maxX - minX);
    const worldH = Math.max(600, maxY - minY);
    const radarW = 196;
    const radarH = 128;
    const scale = Math.min(radarW / worldW, radarH / worldH);
    const offsetX = (radarW - worldW * scale) / 2;
    const offsetY = (radarH - worldH * scale) / 2;

    return {
      minX,
      minY,
      scale,
      offsetX,
      offsetY,
      radarW,
      radarH,
      viewRect: {
        x: offsetX + (viewWorldX - minX) * scale,
        y: offsetY + (viewWorldY - minY) * scale,
        w: Math.max(12, viewWorldW * scale),
        h: Math.max(10, viewWorldH * scale),
      },
    };
  }, [activeMap, allActiveNodes, viewportSize]);

  const visibleEdges = useMemo(() => {
    if (!activeMap) return [];
    return Object.values(activeMap.edges).filter(
      (e) =>
        !e.metadata.deletedAt &&
        activeMap.nodes[e.sourceId] &&
        !activeMap.nodes[e.sourceId].metadata.deletedAt &&
        activeMap.nodes[e.targetId] &&
        !activeMap.nodes[e.targetId].metadata.deletedAt
    );
  }, [activeMap]);

  // Off-screen edge indicator chevrons (OrgPad-style minimalist perimeter chevrons)
  const offscreenIndicators = useMemo(() => {
    if (!activeMap) return [];
    const { panX, panY, zoom } = activeMap.viewport;
    const topBound = 46;
    const w = viewportSize.w;
    const h = viewportSize.h;
    const cx = w / 2;
    const cy = (topBound + h) / 2;
    const pad = 14;

    const indicators: {
      id: UUID;
      x: number;
      y: number;
      angleDeg: number;
      title: string;
      color: string;
    }[] = [];

    for (const node of allActiveNodes) {
      const nw = node.width * zoom;
      const nh = (node.collapsed ? 38 : node.height) * zoom;
      const left = node.x * zoom + panX;
      const top = node.y * zoom + panY;
      const right = left + nw;
      const bottom = top + nh;

      if (right >= 0 && left <= w && bottom >= topBound && top <= h) continue;

      const sx = left + nw / 2;
      const sy = top + nh / 2;
      const dx = sx - cx;
      const dy = sy - cy;
      if (dx === 0 && dy === 0) continue;

      const scaleX = dx !== 0 ? (dx > 0 ? (w - pad - cx) / dx : (pad - cx) / dx) : Infinity;
      const scaleY = dy !== 0 ? (dy > 0 ? (h - pad - cy) / dy : (topBound + pad - cy) / dy) : Infinity;
      const t = Math.min(scaleX, scaleY);

      indicators.push({
        id: node.id,
        x: Math.round(cx + dx * t),
        y: Math.round(cy + dy * t),
        angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
        title: node.title,
        color: node.color && node.color !== 'transparent' ? node.color : '#7c93b0',
      });
    }
    return indicators;
  }, [activeMap, allActiveNodes, viewportSize]);

  // Instant live search across all maps & nodes
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!workspace || !q) return [];
    const hits: { mapId: UUID; mapTitle: string; node: GraphNode }[] = [];
    for (const map of Object.values(workspace.maps)) {
      for (const node of Object.values(map.nodes)) {
        if (node.metadata.deletedAt) continue;
        const bodyText = serializeBlocksToPlainText(node.blocks).toLowerCase();
        if (node.title.toLowerCase().includes(q) || bodyText.includes(q)) {
          hits.push({ mapId: map.id, mapTitle: map.title, node });
        }
      }
    }
    return hits.slice(0, 20);
  }, [workspace, searchQuery]);

  // ==========================================================================
  // Graph Engine Operations (Nodes, Edges, Spatial Layout)
  // ==========================================================================
  const createNodeAt = useCallback(
    (worldX: number, worldY: number, initialColor?: string) => {
      if (!activeMap || presentMode) return;
      const newId = generateUUID();
      const now = new Date().toISOString();
      const parentNode = selectedNodeId ? activeMap.nodes[selectedNodeId] : null;
      const parentColor = parentNode && parentNode.color !== 'transparent' ? parentNode.color : null;
      // New cards inherit the parent's solid color (no blend); edges will show the gradient.
      const bgToUse = initialColor ?? parentColor ?? defaultCardBg;
      const tags: string[] = [];
      if (defaultCardText && defaultCardText !== '#f8fafc') {
        tags.push(`text:${defaultCardText}`);
      }
      commitMutation((draft) => {
        const map = draft.maps[draft.activeMapId];
        map.nodes[newId] = {
          id: newId,
          mapId: map.id,
          title: 'New Idea',
          x: Math.round(worldX - 115),
          y: Math.round(worldY - 40),
          width: 230,
          height: 110,
          color: bgToUse,
          collapsed: false,
          blocks: [
            {
              id: generateUUID(),
              type: 'paragraph',
              spans: [{ text: '' }],
            },
          ],
          nestedMapId: null,
          attachmentIds: [],
          crossMapRefs: [],
          metadata: {
            createdAt: now,
            updatedAt: now,
            owner: 'user',
            tags,
            deletedAt: null,
          },
        };
      });
      setSelectedNodeId(newId);
      setSelectedEdgeId(null);
      setEditingNodeId(newId);
      setEditingDraftTitle('New Idea');
      setEditingDraftText('');
    },
    [activeMap, presentMode, defaultCardBg, defaultCardText, commitMutation]
  );

  const deleteSelection = useCallback(() => {
    if (!activeMap || presentMode) return;
    const ids =
      selectedNodeIds.size > 0
        ? selectedNodeIds
        : selectedNodeId
        ? new Set<UUID>([selectedNodeId])
        : new Set<UUID>();

    if (ids.size > 0) {
      const now = new Date().toISOString();
      commitMutation((draft) => {
        const map = draft.maps[draft.activeMapId];
        for (const id of ids) {
          const node = map.nodes[id];
          if (node) {
            node.metadata.deletedAt = now;
            node.metadata.updatedAt = now;
          }
          Object.values(map.edges).forEach((edge) => {
            if (edge.sourceId === id || edge.targetId === id) {
              edge.metadata.deletedAt = now;
              edge.metadata.updatedAt = now;
            }
          });
        }
      });
      if (editingNodeId && ids.has(editingNodeId)) setEditingNodeId(null);
      if (connectSourceId && ids.has(connectSourceId)) setConnectSourceId(null);
      setSelectedNodeIds(new Set());
      setSelectedNodeId(null);
    } else if (selectedEdgeId && activeMap.edges[selectedEdgeId]) {
      const now = new Date().toISOString();
      commitMutation((draft) => {
        const map = draft.maps[draft.activeMapId];
        const edge = map.edges[selectedEdgeId];
        if (edge) {
          edge.metadata.deletedAt = now;
          edge.metadata.updatedAt = now;
        }
      });
      setSelectedEdgeId(null);
    }
  }, [
    activeMap,
    presentMode,
    selectedNodeId,
    selectedNodeIds,
    selectedEdgeId,
    editingNodeId,
    connectSourceId,
    commitMutation,
  ]);

  const createEdgeBetweenNodes = useCallback(
    (sourceId: UUID, targetId: UUID) => {
      if (!activeMap || presentMode || sourceId === targetId) return;
      const duplicate = visibleEdges.find(
        (e) => e.sourceId === sourceId && e.targetId === targetId
      );
      if (!duplicate) {
        const edgeId = generateUUID();
        const now = new Date().toISOString();
        commitMutation((draft) => {
          const map = draft.maps[draft.activeMapId];
          const srcNode = map.nodes[sourceId];
          const tgtNode = map.nodes[targetId];
          if (srcNode && tgtNode && tgtNode.color !== 'transparent' && srcNode.color !== 'transparent') {
            // Children inherit the parent's color by default (so siblings share the parent look).
            // If the child was already recolored by the user (no longer the default), keep it --
            // the edge gradient will then visibly bridge parent color -> child color.
            if (tgtNode.color === defaultCardBg) {
              tgtNode.color = srcNode.color;
            }
            tgtNode.metadata.updatedAt = now;
          }
          map.edges[edgeId] = {
            id: edgeId,
            mapId: map.id,
            sourceId,
            targetId,
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
        });
        setSelectedEdgeId(edgeId);
        setSelectedNodeId(null);
      }
    },
    [activeMap, presentMode, visibleEdges, commitMutation]
  );

  const handleNodeClickForConnection = useCallback(
    (targetNodeId: UUID) => {
      if (!activeMap) return;
      if (!connectSourceId) {
        setConnectSourceId(targetNodeId);
        setSelectedNodeId(targetNodeId);
        return;
      }
      if (connectSourceId === targetNodeId) {
        setConnectSourceId(null);
        return;
      }

      createEdgeBetweenNodes(connectSourceId, targetNodeId);
      setConnectSourceId(null);
      setConnectMode(false);
    },
    [activeMap, connectSourceId, createEdgeBetweenNodes]
  );

  // ==========================================================================
  // Document Engine Operations (Maps, Breadcrumbs, Nested Maps, Attachments)
  // ==========================================================================
  const focusNodeInViewport = useCallback((node: GraphNode) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const next = cloneEnvelope(prev);
      const map = next.maps[next.activeMapId];
      if (!map) return prev;
      const zoom = map.viewport.zoom;
      map.viewport.panX = Math.round(window.innerWidth / 2 - (node.x + node.width / 2) * zoom);
      map.viewport.panY = Math.round(window.innerHeight / 2 - (node.y + node.height / 2) * zoom);
      return next;
    });
    setSelectedNodeId(node.id);
    setSelectedEdgeId(null);
  }, []);

  const fitAllNodesInView = useCallback(() => {
    if (!activeMap || allActiveNodes.length === 0) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const n of allActiveNodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n.width);
      maxY = Math.max(maxY, n.y + (n.collapsed ? 42 : n.height));
    }

    const pad = 90;
    const contentW = Math.max(200, maxX - minX);
    const contentH = Math.max(200, maxY - minY);
    const availW = Math.max(300, viewportSize.w - pad * 2);
    const availH = Math.max(300, viewportSize.h - pad * 2);

    const zoom = Math.min(
      1.25,
      Math.max(0.2, Number(Math.min(availW / contentW, availH / contentH).toFixed(3)))
    );
    const panX = Math.round((viewportSize.w - contentW * zoom) / 2 - minX * zoom);
    const panY = Math.round((viewportSize.h - contentH * zoom) / 2 - minY * zoom + 24);

    setWorkspace((prev) => {
      if (!prev) return prev;
      const next = cloneEnvelope(prev);
      next.maps[next.activeMapId].viewport = { panX, panY, zoom };
      return next;
    });
  }, [activeMap, allActiveNodes, viewportSize]);

  const switchToMap = useCallback(
    (targetMapId: UUID, focusNodeId?: UUID) => {
      if (!workspace || !workspace.maps[targetMapId]) return;
      if (targetMapId !== workspace.activeMapId) {
        setNavHistory((prev) => [...prev, workspace.activeMapId]);
      }
      setWorkspace((prev) => {
        if (!prev) return prev;
        const next = cloneEnvelope(prev);
        next.activeMapId = targetMapId;
        if (focusNodeId && next.maps[targetMapId]?.nodes[focusNodeId]) {
          const targetNode = next.maps[targetMapId].nodes[focusNodeId];
          const z = next.maps[targetMapId].viewport.zoom;
          next.maps[targetMapId].viewport.panX = Math.round(
            window.innerWidth / 2 - (targetNode.x + targetNode.width / 2) * z
          );
          next.maps[targetMapId].viewport.panY = Math.round(
            window.innerHeight / 2 - (targetNode.y + targetNode.height / 2) * z
          );
        }
        return next;
      });
      setSelectedNodeId(focusNodeId ?? null);
      setSelectedEdgeId(null);
      setEditingNodeId(null);
      setConnectSourceId(null);
    },
    [workspace]
  );

  const navigateBack = useCallback(() => {
    setNavHistory((prev) => {
      if (prev.length === 0) return prev;
      const lastMapId = prev[prev.length - 1];
      setWorkspace((ws) => {
        if (!ws || !ws.maps[lastMapId]) return ws;
        const next = cloneEnvelope(ws);
        next.activeMapId = lastMapId;
        return next;
      });
      setSelectedNodeId(null);
      setSelectedEdgeId(null);
      setEditingNodeId(null);
      return prev.slice(0, -1);
    });
  }, []);

  const createNewWorkspaceMap = useCallback(() => {
    const newMapId = generateUUID();
    const initialNodeId = generateUUID();
    const now = new Date().toISOString();
    commitMutation((draft) => {
      const count = Object.keys(draft.maps).length + 1;
      draft.maps[newMapId] = {
        id: newMapId,
        title: `Map ${count}`,
        parentMapId: null,
        parentNodeId: null,
        viewport: { panX: 160, panY: 140, zoom: 1 },
        nodes: {
          [initialNodeId]: {
            id: initialNodeId,
            mapId: newMapId,
            title: 'Central Concept',
            x: 240,
            y: 180,
            width: 240,
            height: 115,
            color: defaultCardBg,
            collapsed: false,
            blocks: [
              {
                id: generateUUID(),
                type: 'paragraph',
                spans: [{ text: 'Double-click anywhere to expand your map.' }],
              },
            ],
            nestedMapId: null,
            attachmentIds: [],
            crossMapRefs: [],
            metadata: {
              createdAt: now,
              updatedAt: now,
              owner: 'user',
              tags: defaultCardText !== '#f8fafc' ? [`text:${defaultCardText}`] : [],
              deletedAt: null,
            },
          },
        },
        edges: {},
        metadata: { createdAt: now, updatedAt: now, owner: 'user' },
      };
      draft.activeMapId = newMapId;
    });
    setSelectedNodeId(initialNodeId);
    setSelectedEdgeId(null);
  }, [commitMutation, defaultCardBg, defaultCardText]);

  const openOrCreateNestedCanvas = useCallback(
    (nodeId: UUID) => {
      if (!workspace || !activeMap) return;
      const node = activeMap.nodes[nodeId];
      if (!node) return;

      if (node.nestedMapId && workspace.maps[node.nestedMapId]) {
        switchToMap(node.nestedMapId);
        return;
      }

      if (presentMode) return;

      const subMapId = generateUUID();
      const firstSubNodeId = generateUUID();
      const now = new Date().toISOString();

      commitMutation((draft) => {
        const parentMap = draft.maps[draft.activeMapId];
        const parentNode = parentMap.nodes[nodeId];
        parentNode.nestedMapId = subMapId;
        parentNode.metadata.updatedAt = now;

        draft.maps[subMapId] = {
          id: subMapId,
          title: `${parentNode.title} (Nested)`,
          parentMapId: parentMap.id,
          parentNodeId: nodeId,
          viewport: { panX: 140, panY: 140, zoom: 1 },
          nodes: {
            [firstSubNodeId]: {
              id: firstSubNodeId,
              mapId: subMapId,
              title: `${parentNode.title} — Overview`,
              x: 220,
              y: 160,
              width: 250,
              height: 120,
              color: parentNode.color === 'transparent' ? defaultCardBg : parentNode.color,
              collapsed: false,
              blocks: [
                {
                  id: generateUUID(),
                  type: 'paragraph',
                  spans: [{ text: 'Nested sub-canvas linked by persistent UUID.' }],
                },
              ],
              nestedMapId: null,
              attachmentIds: [],
              crossMapRefs: [],
              metadata: {
                createdAt: now,
                updatedAt: now,
                owner: 'user',
                tags: [],
                deletedAt: null,
              },
            },
          },
          edges: {},
          metadata: { createdAt: now, updatedAt: now, owner: 'user' },
        };
        draft.activeMapId = subMapId;
      });
      setNavHistory((prev) => [...prev, activeMap.id]);
      setSelectedNodeId(firstSubNodeId);
      setEditingNodeId(null);
    },
    [workspace, activeMap, presentMode, defaultCardBg, switchToMap, commitMutation]
  );

  const breadcrumbs = useMemo(() => {
    if (!workspace || !activeMap) return [];
    const chain: MindMapDocument[] = [];
    const visited = new Set<UUID>();
    let curr: MindMapDocument | undefined = activeMap;
    while (curr && !visited.has(curr.id)) {
      visited.add(curr.id);
      chain.unshift(curr);
      curr = curr.parentMapId ? workspace.maps[curr.parentMapId] : undefined;
    }
    return chain;
  }, [workspace, activeMap]);

  // ==========================================================================
  // Rich Text Editing & Attachments
  // ==========================================================================
  const startEditingNode = useCallback(
    (node: GraphNode) => {
      if (presentMode) return;
      setEditingNodeId(node.id);
      setEditingDraftTitle(node.title);
      setEditingDraftText(serializeBlocksToPlainText(node.blocks));
      setSelectedNodeId(node.id);
    },
    [presentMode]
  );

  const commitNodeEdits = useCallback(() => {
    if (!editingNodeId || !activeMap) return;
    const targetNode = activeMap.nodes[editingNodeId];
    if (!targetNode) {
      setEditingNodeId(null);
      return;
    }
    const cleanTitle = editingDraftTitle.trim();
    const nextBlocks = createStructuredBlocksFromPlainText(editingDraftText);

    commitMutation((draft) => {
      const node = draft.maps[draft.activeMapId].nodes[editingNodeId];
      if (node) {
        node.title = cleanTitle;
        node.blocks = nextBlocks;
        node.metadata.updatedAt = new Date().toISOString();
      }
    });
    setEditingNodeId(null);
  }, [editingNodeId, activeMap, editingDraftTitle, editingDraftText, commitMutation]);

  useEffect(() => {
    const flushNow = () => {
      if (!workspace || !autosaveEnabled) return;
      const payload = cloneEnvelope(workspace);
      if (editingNodeId && payload.maps[payload.activeMapId]?.nodes[editingNodeId]) {
        const n = payload.maps[payload.activeMapId].nodes[editingNodeId];
        n.title = editingDraftTitle.trim();
        n.blocks = createStructuredBlocksFromPlainText(editingDraftText);
      }
      repoRef.current?.saveWorkspace(payload).catch(() => {});
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') flushNow();
    };
    const onKeySave = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (editingNodeId) commitNodeEdits();
        forceManualSave();
      }
    };

    window.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('beforeunload', flushNow);
    window.addEventListener('keydown', onKeySave);
    return () => {
      window.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('beforeunload', flushNow);
      window.removeEventListener('keydown', onKeySave);
    };
  }, [
    workspace,
    autosaveEnabled,
    editingNodeId,
    editingDraftTitle,
    editingDraftText,
    commitNodeEdits,
    forceManualSave,
  ]);

  const handleAttachFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (!file || !selectedNodeId || !activeMap) return;

      try {
        const buffer = await file.arrayBuffer();
        const attId = generateUUID();
        const meta: AttachmentMeta = {
          id: attId,
          name: file.name,
          mimeType: file.type || 'application/octet-stream',
          size: file.size,
          createdAt: new Date().toISOString(),
        };

        await repoRef.current!.saveAttachment({ meta, data: buffer });

        commitMutation((draft) => {
          draft.attachments[attId] = meta;
          const node = draft.maps[draft.activeMapId].nodes[selectedNodeId];
          if (node) {
            node.attachmentIds.push(attId);
            node.metadata.updatedAt = new Date().toISOString();
          }
        });
        setBannerMessage({
          type: 'success',
          text: `Attached "${file.name}" (${Math.ceil(file.size / 1024)} KB).`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to store attachment';
        setBannerMessage({ type: 'error', text: msg });
      }
    },
    [selectedNodeId, activeMap, commitMutation]
  );

  const handleDownloadAttachment = useCallback(async (attId: UUID) => {
    try {
      const rec = await repoRef.current!.getAttachment(attId);
      if (!rec) {
        setBannerMessage({ type: 'error', text: 'Attachment binary not found in IndexedDB.' });
        return;
      }
      const blob = new Blob([rec.data], { type: rec.meta.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = rec.meta.name;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Unable to download attachment',
      });
    }
  }, []);

  // ==========================================================================
  // Keyboard Shortcuts (Including Tab-to-Node-and-Instant-Edit)
  // ==========================================================================
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);

      const mod = e.metaKey || e.ctrlKey;

      // Tab navigation: cycles through nodes and opens instant text editing on the focused node
      if (e.key === 'Tab' && !mod && !presentMode && allActiveNodes.length > 0) {
        // Allow Tab cycling from canvas OR while inside a node editor (commits current and moves to next/prev node)
        if (!isTyping || editingNodeId) {
          e.preventDefault();
          if (editingNodeId) {
            commitNodeEdits();
          }
          const currentIndex = selectedNodeId
            ? allActiveNodes.findIndex((n) => n.id === selectedNodeId)
            : -1;
          const step = e.shiftKey ? -1 : 1;
          const nextIndex =
            currentIndex === -1
              ? e.shiftKey
                ? allActiveNodes.length - 1
                : 0
              : (currentIndex + step + allActiveNodes.length) % allActiveNodes.length;
          const nextNode = allActiveNodes[nextIndex];
          if (nextNode) {
            if (nextNode.collapsed) {
              commitMutation((draft) => {
                const n = draft.maps[draft.activeMapId].nodes[nextNode.id];
                if (n) n.collapsed = false;
              }, false);
            }
            setSelectedNodeId(nextNode.id);
            setSelectedEdgeId(null);
            setEditingNodeId(nextNode.id);
            setEditingDraftTitle(nextNode.title);
            setEditingDraftText(serializeBlocksToPlainText(nextNode.blocks));
          }
          return;
        }
      }

      // Quick search: Ctrl/Cmd + K or /
      if ((mod && e.key.toLowerCase() === 'k') || (!isTyping && e.key === '/')) {
        e.preventDefault();
        setSearchOpen(true);
        setTimeout(() => searchInputRef.current?.focus(), 30);
        return;
      }

      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        if (!isTyping) {
          e.preventDefault();
          undo();
        }
        return;
      }

      if ((mod && e.key.toLowerCase() === 'y') || (mod && e.shiftKey && e.key.toLowerCase() === 'z')) {
        if (!isTyping) {
          e.preventDefault();
          redo();
        }
        return;
      }

      if (isTyping) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (editingNodeId) commitNodeEdits();
          if (searchOpen) setSearchOpen(false);
        }
        return;
      }

      if (e.key.toLowerCase() === 'n' && !mod && !presentMode) {
        e.preventDefault();
        if (activeMap) {
          const cx = (viewportSize.w / 2 - activeMap.viewport.panX) / activeMap.viewport.zoom;
          const cy = (viewportSize.h / 2 - activeMap.viewport.panY) / activeMap.viewport.zoom;
          createNodeAt(cx, cy);
        }
        return;
      }

      if (e.key.toLowerCase() === 'c' && !mod && !presentMode) {
        e.preventDefault();
        setConnectMode((prev) => {
          const next = !prev;
          setConnectSourceId(next ? selectedNodeId : null);
          return next;
        });
        return;
      }

      if (e.key.toLowerCase() === 'f' && !mod) {
        e.preventDefault();
        fitAllNodesInView();
        return;
      }

      if ((e.key === 'Delete' || e.key === 'Backspace') && !presentMode) {
        e.preventDefault();
        deleteSelection();
        return;
      }

      if (e.key === 'Escape') {
        setConnectMode(false);
        setConnectSourceId(null);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setEditingEdgeId(null);
        setSearchOpen(false);
        setContextMenu(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    undo,
    redo,
    editingNodeId,
    commitNodeEdits,
    commitMutation,
    allActiveNodes,
    searchOpen,
    presentMode,
    activeMap,
    viewportSize,
    createNodeAt,
    selectedNodeId,
    fitAllNodesInView,
    deleteSelection,
  ]);

  // ==========================================================================
  // Smooth Cursor-Anchored Zoom & Pointer Dragging
  // ==========================================================================
  const applyZoomFactor = useCallback((factor: number, anchorScreenX?: number, anchorScreenY?: number) => {
    setWorkspace((prev) => {
      if (!prev) return prev;
      const next = cloneEnvelope(prev);
      const map = next.maps[next.activeMapId];
      if (!map) return prev;

      const cx = anchorScreenX ?? window.innerWidth / 2;
      const cy = anchorScreenY ?? window.innerHeight / 2;
      const oldZoom = map.viewport.zoom;
      const newZoom = Math.min(2.5, Math.max(0.2, Number((oldZoom * factor).toFixed(3))));

      const worldX = (cx - map.viewport.panX) / oldZoom;
      const worldY = (cy - map.viewport.panY) / oldZoom;

      map.viewport.zoom = newZoom;
      map.viewport.panX = Math.round(cx - worldX * newZoom);
      map.viewport.panY = Math.round(cy - worldY * newZoom);
      return next;
    });
  }, []);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'TEXTAREA' || target.closest('.node-editor'))) {
        return;
      }
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cursorX = e.clientX - rect.left;
      const cursorY = e.clientY - rect.top;
      // Normalize trackpad pinch / fine wheel delta vs discrete mouse wheel ticks
      const rawDelta = e.deltaY;
      if (rawDelta === 0) return;
      const intensity = Math.min(Math.abs(rawDelta), 120) / 120;
      const step = 0.08 + intensity * 0.07;
      const factor = rawDelta < 0 ? 1 + step : 1 / (1 + step);
      applyZoomFactor(factor, cursorX, cursorY);
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [workspace !== null, applyZoomFactor]);

  const startLinkDragFromNode = useCallback(
    (node: GraphNode, clientX?: number, clientY?: number) => {
      if (!activeMap || !canvasRef.current || presentMode) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const startX =
        clientX !== undefined
          ? (clientX - rect.left - activeMap.viewport.panX) / activeMap.viewport.zoom
          : node.x + node.width / 2;
      const startY =
        clientY !== undefined
          ? (clientY - rect.top - activeMap.viewport.panY) / activeMap.viewport.zoom
          : node.y + node.height / 2;

      const session: LinkDragSession = {
        sourceNodeId: node.id,
        currentWorldX: startX,
        currentWorldY: startY,
        hoverTargetNodeId: null,
      };
      linkDragRef.current = session;
      setLinkDrag(session);
      setSelectedNodeId(node.id);
      setSelectedEdgeId(null);
    },
    [activeMap, presentMode]
  );

  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    setContextMenu(null);
    const targetEl = e.target as HTMLElement;
    const isCanvasBackground =
      e.target === e.currentTarget ||
      targetEl.classList.contains('canvas-world') ||
      targetEl.classList.contains('edges-layer');

    if (!isCanvasBackground) {
      return;
    }
    if (editingNodeId) {
      commitNodeEdits();
    }
    setSelectedNodeId(null);
    setSelectedEdgeId(null);
    setEditingEdgeId(null);

    if (!activeMap || e.button !== 0) return;
    if (e.metaKey || e.ctrlKey) {
      marqueeStartRef.current = { startX: e.clientX, startY: e.clientY };
      setMarquee({ x1: e.clientX, y1: e.clientY, x2: e.clientX, y2: e.clientY });
      return;
    }
    panSessionRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      initialPanX: activeMap.viewport.panX,
      initialPanY: activeMap.viewport.panY,
    };
  };

  const handleNodePointerDown = (e: React.PointerEvent, node: GraphNode) => {
    e.stopPropagation();
    setContextMenu(null);

    if (presentMode) {
      setSelectedNodeId(node.id);
      if (node.nestedMapId) {
        openOrCreateNestedCanvas(node.id);
      }
      return;
    }

    if (e.button === 0 && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      toggleNodeSelection(node.id);
      return;
    }

    if (e.button === 0 && e.shiftKey) {
      e.preventDefault();
      startLinkDragFromNode(node, e.clientX, e.clientY);
      return;
    }

    if (connectMode && e.button === 0) {
      handleNodeClickForConnection(node.id);
      return;
    }

    if (!selectedNodeIds.has(node.id)) {
      setSingleSelection(node.id);
    } else {
      setSelectedNodeId(node.id);
    }
    setSelectedEdgeId(null);

    if (e.button !== 0 || editingNodeId === node.id || !workspace) return;

    const movingIds =
      selectedNodeIds.has(node.id) && selectedNodeIds.size > 0
        ? Array.from(selectedNodeIds)
        : [node.id];
    const initialPositions: Record<UUID, { x: number; y: number }> = {};
    for (const id of movingIds) {
      const n = activeMap.nodes[id];
      if (n) initialPositions[id] = { x: n.x, y: n.y };
    }

    dragSessionRef.current = {
      nodeId: node.id,
      nodeIds: movingIds,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      initialPositions,
      snapshotBeforeDrag: cloneEnvelope(workspace),
      moved: false,
    };
  };

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      if (marqueeStartRef.current && canvasRef.current && activeMap) {
        const start = marqueeStartRef.current;
        const rect = canvasRef.current.getBoundingClientRect();
        const { panX, panY, zoom } = activeMap.viewport;
        const worldLeft = (Math.min(start.startX, e.clientX) - rect.left - panX) / zoom;
        const worldTop = (Math.min(start.startY, e.clientY) - rect.top - panY) / zoom;
        const worldRight = (Math.max(start.startX, e.clientX) - rect.left - panX) / zoom;
        const worldBottom = (Math.max(start.startY, e.clientY) - rect.top - panY) / zoom;

        const hits: UUID[] = [];
        for (const n of allActiveNodes) {
          const eff = getEffectiveNodeSize(n);
          const nr = n.x + eff.width;
          const nb = n.y + eff.height;
          if (nr >= worldLeft && n.x <= worldRight && nb >= worldTop && n.y <= worldBottom) {
            hits.push(n.id);
          }
        }
        setSelectedNodeIds(new Set(hits));
        setSelectedNodeId(hits.length ? hits[0] : null);
        setMarquee({ x1: start.startX, y1: start.startY, x2: e.clientX, y2: e.clientY });
        return;
      }

      if (linkDragRef.current && canvasRef.current && activeMap) {
        const rect = canvasRef.current.getBoundingClientRect();
        const worldX = (e.clientX - rect.left - activeMap.viewport.panX) / activeMap.viewport.zoom;
        const worldY = (e.clientY - rect.top - activeMap.viewport.panY) / activeMap.viewport.zoom;

        let hoveredId: UUID | null = null;
        for (const candidate of allActiveNodes) {
          if (candidate.id === linkDragRef.current.sourceNodeId) continue;
          const h = candidate.collapsed ? 42 : candidate.height;
          if (
            worldX >= candidate.x &&
            worldX <= candidate.x + candidate.width &&
            worldY >= candidate.y &&
            worldY <= candidate.y + h
          ) {
            hoveredId = candidate.id;
            break;
          }
        }

        const updated: LinkDragSession = {
          ...linkDragRef.current,
          currentWorldX: worldX,
          currentWorldY: worldY,
          hoverTargetNodeId: hoveredId,
        };
        linkDragRef.current = updated;
        if (!rafPendingRef.current) {
          rafPendingRef.current = requestAnimationFrame(() => {
            rafPendingRef.current = null;
            setLinkDrag(linkDragRef.current);
          });
        }
        return;
      }

      if (dragSessionRef.current) {
        const session = dragSessionRef.current;
        const dx = e.clientX - session.startMouseX;
        const dy = e.clientY - session.startMouseY;
        if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
          session.moved = true;
        }
        if (!session.moved) return;

        if (!rafPendingRef.current) {
          rafPendingRef.current = requestAnimationFrame(() => {
            rafPendingRef.current = null;
            setWorkspace((prev) => {
              if (!prev) return prev;
              const next = cloneEnvelope(prev);
              const map = next.maps[next.activeMapId];
              if (!map) return prev;
              for (const id of session.nodeIds) {
                const node = map.nodes[id];
                const init = session.initialPositions[id];
                if (!node || !init) continue;
                node.x = Math.round(init.x + dx / map.viewport.zoom);
                node.y = Math.round(init.y + dy / map.viewport.zoom);
              }
              return next;
            });
          });
        }
      } else if (panSessionRef.current) {
        const pan = panSessionRef.current;
        const dx = e.clientX - pan.startMouseX;
        const dy = e.clientY - pan.startMouseY;

        if (!rafPendingRef.current) {
          rafPendingRef.current = requestAnimationFrame(() => {
            rafPendingRef.current = null;
            setWorkspace((prev) => {
              if (!prev) return prev;
              const next = cloneEnvelope(prev);
              const map = next.maps[next.activeMapId];
              if (!map) return prev;
              map.viewport.panX = Math.round(pan.initialPanX + dx);
              map.viewport.panY = Math.round(pan.initialPanY + dy);
              return next;
            });
          });
        }
      }
    };

    const handlePointerUp = () => {
      if (rafPendingRef.current) {
        cancelAnimationFrame(rafPendingRef.current);
        rafPendingRef.current = null;
      }

      if (marqueeStartRef.current) {
        marqueeStartRef.current = null;
        setMarquee(null);
      }

      if (linkDragRef.current) {
        const session = linkDragRef.current;
        if (session.hoverTargetNodeId) {
          createEdgeBetweenNodes(session.sourceNodeId, session.hoverTargetNodeId);
        }
        linkDragRef.current = null;
        setLinkDrag(null);
      }

      if (dragSessionRef.current) {
        const session = dragSessionRef.current;
        if (session.moved) {
          setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), session.snapshotBeforeDrag]);
          setFuture([]);
          setWorkspace((prev) => {
            if (!prev) return prev;
            const next = cloneEnvelope(prev);
            const map = next.maps[next.activeMapId];
            if (map) {
              const nowIso = new Date().toISOString();
              for (const id of session.nodeIds) {
                const node = map.nodes[id];
                if (node) node.metadata.updatedAt = nowIso;
              }
            }
            return next;
          });
        }
        dragSessionRef.current = null;
      }
      panSessionRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [activeMap, allActiveNodes, createEdgeBetweenNodes]);

  const handleCanvasContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!activeMap || !canvasRef.current || presentMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - activeMap.viewport.panX) / activeMap.viewport.zoom;
    const worldY = (e.clientY - rect.top - activeMap.viewport.panY) / activeMap.viewport.zoom;
    setContextMenu({
      screenX: e.clientX,
      screenY: e.clientY,
      worldX,
      worldY,
    });
  };

  const handleCanvasDoubleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const targetEl = e.target as HTMLElement;
    const isCanvasBg =
      e.target === e.currentTarget ||
      targetEl.classList.contains('canvas-world') ||
      targetEl.classList.contains('edges-layer');
    if (!isCanvasBg) return;

    if (!activeMap || !canvasRef.current || presentMode) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const worldX = (e.clientX - rect.left - activeMap.viewport.panX) / activeMap.viewport.zoom;
    const worldY = (e.clientY - rect.top - activeMap.viewport.panY) / activeMap.viewport.zoom;
    createNodeAt(worldX, worldY);
  };

  // ==========================================================================
  // Export & Validated JSON Import
  // ==========================================================================
  const handleExportJSON = async () => {
    if (!workspace) return;
    try {
      const bundle = await buildExportBundle(workspace, repoRef.current!);
      const jsonStr = JSON.stringify(bundle, null, 2);
      const blob = new Blob([jsonStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `local-mindmap-v${workspace.schemaVersion}-${new Date()
        .toISOString()
        .slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      setBannerMessage({ type: 'success', text: 'Exported versioned workspace JSON bundle.' });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Export failed.',
      });
    }
  };

  const processImportedFile = useCallback(
    async (file: File, dropWorldX?: number, dropWorldY?: number) => {
      try {
        const text = await file.text();
        const lowerName = file.name.toLowerCase();
        const looksLikeJson =
          lowerName.endsWith('.json') ||
          text.trimStart().startsWith('{') ||
          text.trimStart().startsWith('[');

        if (!looksLikeJson && (lowerName.endsWith('.md') || lowerName.endsWith('.markdown') || lowerName.endsWith('.txt'))) {
          if (!activeMap) return;
          const originX =
            dropWorldX ?? (viewportSize.w / 2 - activeMap.viewport.panX) / activeMap.viewport.zoom - 150;
          const originY =
            dropWorldY ?? (viewportSize.h / 2 - activeMap.viewport.panY) / activeMap.viewport.zoom - 120;
          const parsedOutline = parseMarkdownOutlineToNodes(
            text,
            activeMap.id,
            originX,
            originY,
            defaultCardBg,
            defaultCardText
          );
          const importedIds = Object.keys(parsedOutline.nodes);
          commitMutation((draft) => {
            const map = draft.maps[draft.activeMapId];
            Object.assign(map.nodes, parsedOutline.nodes);
            Object.assign(map.edges, parsedOutline.edges);
          });
          if (importedIds.length > 0) {
            setSelectedNodeId(importedIds[0]);
            setSelectedEdgeId(null);
          }
          setBannerMessage({
            type: 'success',
            text: `Imported ${importedIds.length} card(s) from "${file.name}".`,
          });
          return;
        }

        const result = await parseAndValidateImport(text, repoRef.current!);

        if (workspace) {
          setPast((p) => [...p.slice(-(MAX_HISTORY - 1)), cloneEnvelope(workspace)]);
          setFuture([]);
        }
        setWorkspace(result.envelope);
        setSelectedNodeId(null);
        setSelectedEdgeId(null);
        setEditingNodeId(null);
        setNavHistory([]);

        const migrationNote =
          result.migratedFrom !== undefined
            ? ` (migrated from schema v${result.migratedFrom} -> v${result.envelope.schemaVersion})`
            : '';
        setBannerMessage({
          type: 'success',
          text: `Imported "${file.name}" successfully${migrationNote}.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Invalid file.';
        setBannerMessage({
          type: 'error',
          text: `Import rejected (existing workspace preserved): ${msg}`,
        });
      }
    },
    [activeMap, viewportSize, defaultCardBg, defaultCardText, commitMutation, workspace]
  );

  const handleImportJSON = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    await processImportedFile(file);
  };

  if (!workspace || !activeMap) {
    return <div className="loading-screen">Loading LocalPad...</div>;
  }

  const selectedNode = selectedNodeId ? activeMap.nodes[selectedNodeId] ?? null : null;
  const selectedEdge = selectedEdgeId ? activeMap.edges[selectedEdgeId] ?? null : null;
  const activeIconTag =
    selectedNode?.metadata.tags.find((t) => t.startsWith('icon:'))?.slice(5) ?? '';
  const selectedNodeTextColor =
    selectedNode?.metadata.tags.find((t) => t.startsWith('text:'))?.slice(5) ?? defaultCardText;

  // CSS Custom Properties derived from the selected Editor Theme & Custom Canvas Background
  const themeStyleVars = {
    ['--bg-canvas' as string]: customCanvasBg || activeTheme.bgCanvas,
    ['--topbar-bg' as string]: activeTheme.topbarBg,
    ['--topbar-border' as string]: activeTheme.topbarBorder,
    ['--surface' as string]: activeTheme.surface,
    ['--surface-elevated' as string]: activeTheme.surfaceElevated,
    ['--border' as string]: activeTheme.border,
    ['--text-main' as string]: activeTheme.textMain,
    ['--text-muted' as string]: activeTheme.textMuted,
    ['--primary' as string]: activeTheme.primary,
    ['--primary-bg' as string]: activeTheme.primaryBg,
    ['--edge-color' as string]: activeTheme.edgeColor,
  } as React.CSSProperties;

  return (
    <div className="app-shell" style={themeStyleVars}>
      {/* Minimalist Top Header Bar */}
      <header className="orgpad-topbar">
        {/* Left: Brand Logo, Inline Editable Document Title, Breadcrumbs */}
        <div className="topbar-left">
          <div className="app-logo" title={`LocalPad � Schema v${workspace.schemaVersion}`}>
            <span className="logo-text">LocalPad</span>
          </div>

          <div className="doc-title-wrap">
            <input
              className="doc-title-input"
              value={activeMap.title}
              disabled={presentMode}
              onChange={(e) => {
                const val = e.target.value;
                commitMutation((draft) => {
                  draft.maps[draft.activeMapId].title = val;
                });
              }}
              aria-label="Map Title"
            />
            {!presentMode && <span className="title-edit-pen">✎</span>}
          </div>

          {breadcrumbs.length > 1 && (
            <div className="topbar-breadcrumbs">
              <button
                className="pill-btn-sm"
                onClick={navigateBack}
                disabled={navHistory.length === 0}
                title="Backtrack"
              >
                ←
              </button>
              {breadcrumbs.map((m, idx) => (
                <React.Fragment key={m.id}>
                  {idx > 0 && <span className="crumb-sep">/</span>}
                  <button
                    className={`crumb-btn ${m.id === activeMap.id ? 'crumb-active' : ''}`}
                    onClick={() => switchToMap(m.id)}
                  >
                    {m.title}
                  </button>
                </React.Fragment>
              ))}
            </div>
          )}
        </div>

        {/* Right: Search, Quick Creation Pill (Aa | ->), Undo/Redo, Present, Export & Right Organisation/Settings Toggle */}
        <div className="topbar-right">
          <button
            className={`icon-tool-btn ${searchOpen ? 'tool-active' : ''}`}
            onClick={() => {
              setSearchOpen((o) => !o);
              setTimeout(() => searchInputRef.current?.focus(), 30);
            }}
            title="Search across maps & cards (Ctrl/Cmd + K)"
          >
            🔍
          </button>

          {!presentMode && (
            <div className="creation-capsule">
              <button
                className="capsule-btn"
                onClick={() => {
                  const cx = (viewportSize.w / 2 - activeMap.viewport.panX) / activeMap.viewport.zoom;
                  const cy = (viewportSize.h / 2 - activeMap.viewport.panY) / activeMap.viewport.zoom;
                  createNodeAt(cx, cy);
                }}
                title="Create new text card (N or double-click canvas)"
              >
                <span className="capsule-aa">Aa</span>
              </button>
              <span className="capsule-divider" />
              <button
                className={`capsule-btn ${connectMode ? 'capsule-active' : ''}`}
                onClick={() => {
                  setConnectMode((prev) => {
                    const next = !prev;
                    setConnectSourceId(next ? selectedNodeId : null);
                    return next;
                  });
                }}
                title="Connect cards (C, or Shift + Left-Drag from any card)"
              >
                <span className="capsule-arrow">⟶</span>
              </button>
            </div>
          )}

          {!presentMode && (
            <div className="history-group">
              <button
                className="icon-tool-btn"
                onClick={undo}
                disabled={past.length === 0}
                title="Undo (Ctrl/Cmd + Z)"
              >
                ↶
              </button>
              <button
                className="icon-tool-btn"
                onClick={redo}
                disabled={future.length === 0}
                title="Redo (Ctrl/Cmd + Y)"
              >
                ↷
              </button>
            </div>
          )}

          <button
            className={`topbar-pill-btn ${presentMode ? 'pill-present-active' : ''}`}
            onClick={() => {
              setPresentMode((p) => !p);
              setEditingNodeId(null);
              setConnectMode(false);
            }}
            title="Toggle distraction-free Presentation Mode"
          >
            ▶ {presentMode ? 'EDIT' : 'PRESENT'}
          </button>

          <button
            className="topbar-pill-btn"
            onClick={() => fileImportInputRef.current?.click()}
            title="Import JSON workspace backup or Markdown (.md/.txt) outline"
          >
            ↙ IMPORT
          </button>

          <button
            className="topbar-pill-btn"
            onClick={handleExportJSON}
            title="Export versioned JSON backup"
          >
            ↗ EXPORT
          </button>

          <button
            type="button"
            className={`save-dot-badge save-${saveStatus.state}`}
            style={{ border: 'none', cursor: 'pointer' }}
            onClick={() => {
              if (editingNodeId) commitNodeEdits();
              forceManualSave();
            }}
            title={
              saveStatus.state === 'error'
                ? `Save failed: ${saveStatus.message} (Click to retry)`
                : `Autosave ${autosaveEnabled ? 'ON' : 'OFF'} · Last saved ${
                    saveStatus.timestamp ?? 'just now'
                  } (Click or Ctrl+S to save now)`
            }
          >
            <span className="status-dot" />
            {saveStatus.state === 'error'
              ? 'Retry Save'
              : saveStatus.state === 'saving'
              ? 'Autosaving…'
              : autosaveEnabled
              ? `Autosaved ${saveStatus.timestamp ?? ''}`
              : 'Autosave Off'}
          </button>

          <button
            className={`topbar-pill-btn ${rightPanelOpen ? 'pill-present-active' : ''}`}
            onClick={() => setRightPanelOpen((o) => !o)}
            title="Toggle Organisation, Theme & Settings Panel"
          >
            ⚙ ORGANISE
          </button>
        </div>
      </header>

      {/* Explicit Save-Failure / Migration Banner */}
      {(bannerMessage || saveStatus.state === 'error') && (
        <div
          className={`floating-banner ${
            saveStatus.state === 'error' || bannerMessage?.type === 'error'
              ? 'banner-error'
              : bannerMessage?.type === 'success'
              ? 'banner-success'
              : 'banner-info'
          }`}
        >
          <span>
            {saveStatus.state === 'error'
              ? `Persistence Error: ${saveStatus.message}`
              : bannerMessage?.text}
          </span>
          <div className="banner-actions">
            {saveStatus.state === 'error' && (
              <button className="pill-btn-sm" onClick={forceManualSave}>
                Retry Save
              </button>
            )}
            <button className="pill-btn-sm" onClick={() => setBannerMessage(null)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Quick Search Palette Overlay */}
      {searchOpen && (
        <div className="search-popover" onPointerDown={(e) => e.stopPropagation()}>
          <input
            ref={searchInputRef}
            className="search-input"
            placeholder="Jump to any card or nested map..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery.trim() && (
            <div className="search-results">
              {searchResults.length === 0 ? (
                <div className="search-empty">No matching cards found.</div>
              ) : (
                searchResults.map((hit) => (
                  <button
                    key={hit.node.id}
                    className="search-item"
                    onClick={() => {
                      if (hit.mapId !== activeMap.id) {
                        switchToMap(hit.mapId, hit.node.id);
                      } else {
                        focusNodeInViewport(hit.node);
                      }
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                  >
                    <span className="search-item-title">{hit.node.title}</span>
                    <span className="search-item-map">{hit.mapTitle}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {/* Right-Side Organisation, Settings & Theme Drawer */}
      {rightPanelOpen && (
        <aside className="right-drawer" onPointerDown={(e) => e.stopPropagation()}>
          <div className="drawer-header">
            <span>Organisation & Settings</span>
            <button className="pill-btn-sm" onClick={() => setRightPanelOpen(false)}>
              ✕
            </button>
          </div>

          {/* Section 1: Workspace Maps Organisation */}
          <div className="drawer-section">
            <div className="drawer-section-row">
              <div className="drawer-label">Workspace Maps</div>
              <button className="pill-btn-sm pill-primary" onClick={createNewWorkspaceMap}>
                + New Map
              </button>
            </div>
            <div className="drawer-map-list">
              {Object.values(workspace.maps).map((m) => {
                const mapCount = Object.keys(workspace.maps).length;
                return (
                  <div
                    key={m.id}
                    className={`drawer-map-item ${m.id === activeMap.id ? 'drawer-map-active' : ''}`}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingRight: 6 }}
                    onClick={() => switchToMap(m.id)}
                  >
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.title}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span className="drawer-count">
                        {Object.values(m.nodes).filter((n) => !n.metadata.deletedAt).length}
                      </span>
                      {mapCount > 1 && (
                        <button
                          type="button"
                          className="pill-btn-sm pill-danger"
                          style={{ padding: '1px 6px', fontSize: 10, lineHeight: 1.2 }}
                          title="Delete map completely"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`Are you sure you want to delete map "${m.title}" completely?`)) {
                              commitMutation((draft) => {
                                const remainingIds = Object.keys(draft.maps).filter((id) => id !== m.id);
                                if (remainingIds.length === 0) return;
                                delete draft.maps[m.id];
                                if (draft.activeMapId === m.id) {
                                  draft.activeMapId = remainingIds[0];
                                }
                                // Clear nestedMapId references pointing to this deleted map
                                for (const mapObj of Object.values(draft.maps)) {
                                  for (const nodeObj of Object.values(mapObj.nodes)) {
                                    if (nodeObj.nestedMapId === m.id) {
                                      nodeObj.nestedMapId = null;
                                    }
                                  }
                                }
                              });
                              if (workspace.activeMapId === m.id) {
                                const remaining = Object.keys(workspace.maps).filter((id) => id !== m.id);
                                if (remaining.length > 0) {
                                  switchToMap(remaining[0]);
                                }
                              }
                            }
                          }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <hr className="drawer-divider" />

          {/* Section 2: Editor Theme Presets */}
          <div className="drawer-section">
            <div className="drawer-label">Editor Theme</div>
            <div className="theme-grid">
              {EDITOR_THEMES.map((preset) => (
                <button
                  key={preset.id}
                  className={`theme-preset-btn ${themeId === preset.id ? 'theme-preset-active' : ''}`}
                  onClick={() => {
                    setThemeId(preset.id);
                    setCustomCanvasBg(null);
                    setDefaultCardBg(preset.defaultNodeBg);
                    setDefaultCardText(preset.nodeTextColor);
                  }}
                >
                  <span
                    className="theme-dot"
                    style={{
                      background: `linear-gradient(135deg, ${preset.bgCanvas} 50%, ${preset.primary} 50%)`,
                    }}
                  />
                  <span>{preset.name}</span>
                </button>
              ))}
            </div>
          </div>

          <hr className="drawer-divider" />

          {/* Section 3: Text & Background Color Palette */}
          <div className="drawer-section">
            <div className="drawer-label">Canvas Background</div>
            <div className="palette-row">
              {['#1c1d1f', '#272822', '#282a36', '#2e3440', '#002b36', '#f6f8fa'].map((bgHex) => (
                <button
                  key={bgHex}
                  className={`swatch ${(customCanvasBg ?? activeTheme.bgCanvas) === bgHex ? 'swatch-active' : ''}`}
                  style={{ backgroundColor: bgHex }}
                  title={`Canvas background ${bgHex}`}
                  onClick={() => setCustomCanvasBg(bgHex)}
                />
              ))}
              <input
                type="color"
                className="native-color-picker"
                value={customCanvasBg ?? activeTheme.bgCanvas}
                title="Custom canvas background color"
                onChange={(e) => setCustomCanvasBg(e.target.value)}
              />
            </div>

            <div className="drawer-label" style={{ marginTop: 6 }}>
              Card Background Palette {selectedNode ? '(Selected Card)' : '(Default)'}
            </div>
            <div className="palette-row">
              {NODE_BG_COLORS.filter((c) => c.value !== 'transparent').map((c) => {
                const activeBg = selectedNode ? selectedNode.color : defaultCardBg;
                return (
                  <button
                    key={c.value}
                    className={`swatch ${activeBg === c.value ? 'swatch-active' : ''}`}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                    onClick={() => {
                      setDefaultCardBg(c.value);
                      if (selectedNode) {
                        commitMutation((draft) => {
                          const n = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                          if (n) n.color = c.value;
                        });
                      }
                    }}
                  />
                );
              })}
              <input
                type="color"
                className="native-color-picker"
                value={
                  selectedNode && selectedNode.color !== 'transparent'
                    ? selectedNode.color
                    : defaultCardBg
                }
                title="Custom card background color"
                onChange={(e) => {
                  const val = e.target.value;
                  setDefaultCardBg(val);
                  if (selectedNode) {
                    commitMutation((draft) => {
                      const n = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                      if (n) n.color = val;
                    });
                  }
                }}
              />
            </div>

            <div className="drawer-label" style={{ marginTop: 6 }}>
              Card Text Palette {selectedNode ? '(Selected Card)' : '(Default)'}
            </div>
            <div className="palette-row">
              {NODE_TEXT_COLORS.map((tc) => {
                const activeTxt = selectedNode ? selectedNodeTextColor : defaultCardText;
                return (
                  <button
                    key={tc.value}
                    className={`swatch text-swatch ${activeTxt === tc.value ? 'swatch-active' : ''}`}
                    style={{ backgroundColor: '#1e2229', color: tc.value }}
                    title={tc.name}
                    onClick={() => {
                      setDefaultCardText(tc.value);
                      if (selectedNode) {
                        commitMutation((draft) => {
                          const n = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                          if (!n) return;
                          const filtered = n.metadata.tags.filter((t) => !t.startsWith('text:'));
                          filtered.push(`text:${tc.value}`);
                          n.metadata.tags = filtered;
                        });
                      }
                    }}
                  >
                    A
                  </button>
                );
              })}
              <input
                type="color"
                className="native-color-picker"
                value={selectedNode ? selectedNodeTextColor : defaultCardText}
                title="Custom card text color"
                onChange={(e) => {
                  const val = e.target.value;
                  setDefaultCardText(val);
                  if (selectedNode) {
                    commitMutation((draft) => {
                      const n = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                      if (!n) return;
                      const filtered = n.metadata.tags.filter((t) => !t.startsWith('text:'));
                      filtered.push(`text:${val}`);
                      n.metadata.tags = filtered;
                    });
                  }
                }}
              />
            </div>
          </div>

          <hr className="drawer-divider" />

          {/* Section 4: Backup & Offline Storage */}
          <div className="drawer-section">
            <div className="drawer-label">Backup & Offline Storage</div>
            <div className="drawer-section-row">
              <span style={{ fontSize: 12 }}>Autosave to Browser</span>
              <button
                className={`pill-btn-sm ${autosaveEnabled ? 'pill-primary' : ''}`}
                onClick={() => setAutosaveEnabled((v) => !v)}
              >
                {autosaveEnabled ? 'ON' : 'OFF'}
              </button>
            </div>
            <button
              className="drawer-action-btn"
              onClick={() => {
                if (editingNodeId) commitNodeEdits();
                forceManualSave();
              }}
            >
              Save Now (Ctrl/Cmd + S)
            </button>
            <button className="drawer-action-btn" onClick={handleExportJSON}>
              Export Versioned JSON
            </button>
            <button
              className="drawer-action-btn"
              onClick={() => fileImportInputRef.current?.click()}
            >
              Import JSON / Markdown
            </button>
          </div>

          <div className="drawer-help">
            <div><strong>Tab</strong> → jump to node & edit instantly</div>
            <div><strong>Shift + Left-Drag</strong> card → connect</div>
            <div><strong>Double-click</strong> canvas → new card</div>
            <div><strong>Mouse Wheel</strong> → zoom in &amp; out</div>
          </div>
        </aside>
      )}

      <input
        ref={fileImportInputRef}
        type="file"
        accept="application/json,.json,.md,.markdown,.txt"
        style={{ display: 'none' }}
        onChange={handleImportJSON}
      />

      {/* Full-Viewport Infinite Canvas */}
      <main
        ref={canvasRef}
        className={`orgpad-canvas ${connectMode || linkDrag ? 'cursor-crosshair' : ''}`}
        onPointerDown={handleCanvasPointerDown}
        onDoubleClick={handleCanvasDoubleClick}
        onContextMenu={handleCanvasContextMenu}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('Files')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            if (!isDraggingFile) setIsDraggingFile(true);
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node | null)) {
            setIsDraggingFile(false);
          }
        }}
        onDrop={async (e) => {
          e.preventDefault();
          setIsDraggingFile(false);
          const file = e.dataTransfer.files?.[0];
          if (!file || !canvasRef.current) return;
          const rect = canvasRef.current.getBoundingClientRect();
          const worldX = (e.clientX - rect.left - activeMap.viewport.panX) / activeMap.viewport.zoom;
          const worldY = (e.clientY - rect.top - activeMap.viewport.panY) / activeMap.viewport.zoom;
          await processImportedFile(file, worldX, worldY);
        }}
      >
        {isDraggingFile && (
          <div className="drop-import-overlay">
            <div className="drop-import-card">
              Drop <strong>.json</strong> workspace backup or <strong>.md / .txt</strong> outline to import
            </div>
          </div>
        )}
        <div
          ref={worldRef}
          className="canvas-world"
          style={{
            transform: `translate3d(${activeMap.viewport.panX}px, ${activeMap.viewport.panY}px, 0)`,
            transformOrigin: '0 0',
          }}
        >
          {/* Viewport-Culled Spatial Cards & Icon Nodes (rendered beneath SVG arrow overlay so cards never clip arrowheads or curves) */}
          {culledNodes.map((node) => {
            const isSelected = selectedNodeIds.has(node.id) || node.id === selectedNodeId;
            const depth = getNodeHierarchyDepth(node.id, activeMap);
            const baseTitlePx = Math.max(12, Math.round(20 - depth * 2.6));
            const bodyScale = Math.max(0.82, 1 - depth * 0.07);
            const isConnectSource =
              node.id === connectSourceId || linkDrag?.sourceNodeId === node.id;
            const isLinkHoverTarget = linkDrag?.hoverTargetNodeId === node.id;
            const isEditing = node.id === editingNodeId;
            const iconTag = node.metadata.tags.find((t) => t.startsWith('icon:'))?.slice(5);
            const nodeTextColor =
              node.metadata.tags.find((t) => t.startsWith('text:'))?.slice(5) ?? defaultCardText;
            const isTransparentIcon = Boolean(iconTag) && node.color === 'transparent';

            return (
              <div
                key={node.id}
                ref={(el) => {
                  if (el) nodeDomRefs.current.set(node.id, el);
                  else nodeDomRefs.current.delete(node.id);
                }}
                tabIndex={0}
                onFocus={() => {
                  if (!presentMode && editingNodeId !== node.id) {
                    setSelectedNodeId(node.id);
                    setSelectedEdgeId(null);
                    startEditingNode(node);
                  }
                }}
                className={`mind-node ${isSelected ? 'node-selected' : ''} ${
                  isConnectSource ? 'node-connect-source' : ''
                } ${isLinkHoverTarget ? 'node-link-target' : ''} ${
                  isTransparentIcon ? 'node-icon-only' : ''
                }`}
                style={{
                  left: Math.round(node.x * activeMap.viewport.zoom),
                  top: Math.round(node.y * activeMap.viewport.zoom),
                  width: Math.round((isTransparentIcon ? 120 : node.width) * activeMap.viewport.zoom),
                  height: 'auto',
                  minHeight: Math.round(
                    (isTransparentIcon ? 90 : 84) *
                      activeMap.viewport.zoom
                  ),
                  background: isTransparentIcon ? 'transparent' : node.color,
                  color: nodeTextColor,
                  ['--zoom' as string]: activeMap.viewport.zoom,
		  ['--body-scale' as string]: bodyScale,
                }}
                onPointerDown={(e) => handleNodePointerDown(e, node)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (presentMode) return;
                  setSelectedNodeId(node.id);
                  setSelectedEdgeId(null);
                  setContextMenu({
                    screenX: e.clientX,
                    screenY: e.clientY,
                    worldX: node.x,
                    worldY: node.y,
                    targetNodeId: node.id,
                  });
                }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  if (!isEditing && !presentMode) startEditingNode(node);
                }}
              >
                {isTransparentIcon ? (
                  <div className="icon-node-content" title={node.title}>
                    {renderNodeGlyph(iconTag)}
                    {isSelected && <div className="icon-node-caption">{node.title}</div>}
                  </div>
                ) : (
                  <>
                    {(() => {
                      const hasTitle = Boolean(node.title && node.title.trim().length > 0);
                      return (
                        <div
                          className={`node-header ${!hasTitle && !isEditing ? 'node-header-titleless' : ''}`}
                          style={{
                            ['--title-size' as string]: `${baseTitlePx}px`,
                          }}
                        >
                          {iconTag && <span className="inline-glyph">{renderNodeGlyph(iconTag)}</span>}
                          {isEditing ? (
                            <input
                              className="node-title-input"
                              value={editingDraftTitle}
                              placeholder="Optional title (leave blank for titleless card)..."
                              onChange={(e) => setEditingDraftTitle(e.target.value)}
                              onPointerDown={(e) => e.stopPropagation()}
                            />
                          ) : hasTitle ? (
                            <span
                              className="node-title"
                              style={{ fontSize: `calc(${baseTitlePx}px * var(--zoom, 1))` }}
                            >
                              {node.title}
                            </span>
                          ) : (
                            <span className="node-title-spacer" />
                          )}

                          {!presentMode && (
                            <div className="node-header-actions">
                              <button
                                className="node-mini-btn"
                                title="Drag to connect (or Shift + Left-Drag card)"
                                onPointerDown={(e) => {
                                  e.stopPropagation();
                                  if (e.button === 0) {
                                    startLinkDragFromNode(node, e.clientX, e.clientY);
                                  }
                                }}
                              >
                                ↗
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {true && (
                      <div className="node-body">
                        {isEditing ? (
                          <div className="node-editor" onPointerDown={(e) => e.stopPropagation()}>
                            <textarea
                              className="node-textarea"
                              rows={4}
                              autoFocus
                              value={editingDraftText}
                              onChange={(e) => setEditingDraftText(e.target.value)}
                              placeholder="Type text directly... (# Heading, - Bullet, **bold**)"
                            />
                            <div className="editor-actions">
                              <button className="pill-btn-sm pill-primary" onClick={commitNodeEdits}>
                                Done
                              </button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="node-blocks">{renderContentBlocks(node.blocks)}</div>

                            {node.nestedMapId && (
                              <button
                                className="node-chip chip-nested"
                                onPointerDown={(e) => e.stopPropagation()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openOrCreateNestedCanvas(node.id);
                                }}
                              >
                                ↳ Open Sub-Canvas
                              </button>
                            )}



                            {node.attachmentIds.length > 0 && (
                              <div className="node-chips">
                                {node.attachmentIds.map((attId) => {
                                  const meta = workspace.attachments[attId];
                                  return (
                                    <button
                                      key={attId}
                                      className="node-chip"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleDownloadAttachment(attId);
                                      }}
                                    >
                                      📎 {meta ? meta.name : 'Attachment'}
                                    </button>
                                  );
                                })}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}

          {/* Crisp Native-DPI SVG Relationship Edges (layered BELOW cards via CSS z-index so arrowheads never cover card text) */}
          <svg className="edges-layer" width="20000" height="20000">
            <defs>
              {/* Per-edge gradients are injected below, inside the visibleEdges.map */}
              <marker
                id="arrowhead"
                markerWidth="9"
                markerHeight="7"
                refX="8"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 9 3.5, 0 7" className="edge-arrow-fill" />
              </marker>
              <marker
                id="arrowhead-selected"
                markerWidth="9"
                markerHeight="7"
                refX="8"
                refY="3.5"
                orient="auto"
              >
                <polygon points="0 0, 9 3.5, 0 7" fill="#60a5fa" />
              </marker>
            </defs>

            {(() => {
              const z = activeMap.viewport.zoom;
              const pairGroups = new Map<string, GraphEdge[]>();
              for (const edge of visibleEdges) {
                const pairKey = [edge.sourceId, edge.targetId].sort().join('::');
                const arr = pairGroups.get(pairKey) ?? [];
                arr.push(edge);
                pairGroups.set(pairKey, arr);
              }

              const obstacleBoxes = culledNodes.map((n) => {
                const eff = getEffectiveNodeSize(n);
                const nw = eff.width * z;
                const nh = eff.height * z;
                return {
                  id: n.id,
                  cx: n.x * z + nw / 2,
                  cy: n.y * z + nh / 2,
                  hw: nw / 2,
                  hh: nh / 2,
                };
              });

              return visibleEdges.map((edge: GraphEdge) => {
                const src = activeMap.nodes[edge.sourceId];
                const tgt = activeMap.nodes[edge.targetId];
                if (!src || !tgt) return null;

                const pairKey = [edge.sourceId, edge.targetId].sort().join('::');
                const siblings = pairGroups.get(pairKey) ?? [edge];
                const bundleIndex = siblings.findIndex((e) => e.id === edge.id);

                const srcEff = getEffectiveNodeSize(src);
                const tgtEff = getEffectiveNodeSize(tgt);

                const srcW = srcEff.width * z;
                const srcH = srcEff.height * z;
                const tgtW = tgtEff.width * z;
                const tgtH = tgtEff.height * z;

                const srcCx = src.x * z + srcW / 2;
                const srcCy = src.y * z + srcH / 2;
                const tgtCx = tgt.x * z + tgtW / 2;
                const tgtCy = tgt.y * z + tgtH / 2;

                // Clear the card body AND the arrowhead length so lines/arrows never sit on text
                const startPt = getRectEdgePoint(srcCx, srcCy, srcW, srcH, tgtCx, tgtCy, 6 * z);
                const endPt = getRectEdgePoint(tgtCx, tgtCy, tgtW, tgtH, srcCx, srcCy, 11 * z);

                const routed = computeSmartEdgePath(
                  startPt.x,
                  startPt.y,
                  endPt.x,
                  endPt.y,
                  bundleIndex,
                  siblings.length,
                  obstacleBoxes,
                  src.id,
                  tgt.id,
                  z
                );

                const isSelected = edge.id === selectedEdgeId;
                const labelFontSize = Math.max(9, Math.round(11 * z));

                // Two-stop gradient along the actual edge geometry, from source node color
                // to target node color. Siblings sharing a parent therefore show a smooth
                // parent->child transition; identical endpoint colors render as a flat line.
                const srcColor = src.color === 'transparent' ? activeTheme.edgeColor : src.color;
                const tgtColor = tgt.color === 'transparent' ? activeTheme.edgeColor : tgt.color;
                const gradId = `edge-grad-${edge.id}`;

                return (
                  <g
                    key={edge.id}
                    className="edge-group"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedEdgeId(edge.id);
                      setSelectedNodeId(null);
                    }}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      if (!presentMode) {
                        setEditingEdgeId(edge.id);
                        setEdgeLabelDraft(edge.label);
                      }
                    }}
                  >
                    <defs>
                      <linearGradient
                        id={gradId}
                        gradientUnits="userSpaceOnUse"
                        x1={startPt.x}
                        y1={startPt.y}
                        x2={endPt.x}
                        y2={endPt.y}
                      >
                        <stop offset="0%" stopColor={srcColor} />
                        <stop offset="100%" stopColor={tgtColor} />
                      </linearGradient>
                    </defs>
                    <path d={routed.d} fill="none" stroke="transparent" strokeWidth={16} />
                    <path
                      d={routed.d}
                      fill="none"
                      className={isSelected ? 'edge-stroke-selected' : 'edge-stroke'}
                      style={isSelected ? undefined : { stroke: `url(#${gradId})`, opacity: 0.9 }}
                      strokeWidth={Math.max(1.4, (isSelected ? 2.4 : 1.65) * Math.sqrt(z))}
                      strokeDasharray={edge.style === 'dashed' ? `${5 * z} ${4 * z}` : undefined}
                      markerEnd={
                        edge.directed
                          ? isSelected
                            ? 'url(#arrowhead-selected)'
                            : 'url(#arrowhead)'
                          : undefined
                      }
                    />
                    {edge.label && (
                      <g transform={`translate(${routed.midX}, ${routed.midY})`}>
                        <rect
                          x={(-edge.label.length * 3.4 - 7) * z}
                          y={-10 * z}
                          width={(edge.label.length * 6.8 + 14) * z}
                          height={20 * z}
                          rx={5 * z}
                          className="edge-label-bg"
                        />
                        <text
                          textAnchor="middle"
                          dominantBaseline="middle"
                          fontSize={labelFontSize}
                          className="edge-label-text"
                        >
                          {edge.label}
                        </text>
                      </g>
                    )}
                  </g>
                );
              });
            })()}

            {/* Live preview line during Shift + Left-Drag connection */}
            {linkDrag &&
              activeMap.nodes[linkDrag.sourceNodeId] &&
              (() => {
                const z = activeMap.viewport.zoom;
                const src = activeMap.nodes[linkDrag.sourceNodeId];
                const sx = (src.x + src.width / 2) * z;
                const sy = (src.y + (src.collapsed ? 19 : src.height / 2)) * z;
                const hoverNode = linkDrag.hoverTargetNodeId
                  ? activeMap.nodes[linkDrag.hoverTargetNodeId]
                  : null;
                const tx = hoverNode
                  ? (hoverNode.x + hoverNode.width / 2) * z
                  : linkDrag.currentWorldX * z;
                const ty = hoverNode
                  ? (hoverNode.y + (hoverNode.collapsed ? 19 : hoverNode.height / 2)) * z
                  : linkDrag.currentWorldY * z;
                return (
                  <line
                    x1={sx}
                    y1={sy}
                    x2={tx}
                    y2={ty}
                    stroke="#34d399"
                    strokeWidth={2}
                    strokeDasharray="5 4"
                    markerEnd="url(#arrowhead)"
                  />
                );
              })()}
          </svg>
        </div>

        {marquee && (
          <div
            className="marquee-box"
            style={{
              left: Math.min(marquee.x1, marquee.x2),
              top: Math.min(marquee.y1, marquee.y2),
              width: Math.abs(marquee.x2 - marquee.x1),
              height: Math.abs(marquee.y2 - marquee.y1),
            }}
          />
        )}


        {/* Off-Screen Node Edge Indicators (OrgPad-style crisp perimeter chevrons) */}
        {offscreenIndicators.map((ind) => (
          <button
            key={ind.id}
            className="offscreen-indicator"
            style={{
              left: ind.x,
              top: ind.y,
              transform: `translate(-50%, -50%) rotate(${ind.angleDeg}deg)`,
            }}
            data-title={ind.title}
            title={`Jump to "${ind.title}"`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => {
              const target = activeMap.nodes[ind.id];
              if (target) focusNodeInViewport(target);
            }}
          >
            <svg
              className="offscreen-chevron-svg"
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
            >
              <path
                d="M4.5 2.5L9.5 7L4.5 11.5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        ))}

        {/* Contextual Floating Inspector (Only appears when a Node or Edge is selected in Edit mode) */}
        {!presentMode && (selectedNode || selectedEdge) && (
          <div className="floating-inspector" onPointerDown={(e) => e.stopPropagation()}>
            {selectedNode ? (
              <>
                <div className="inspector-row">
                  {selectedNodeIds.size > 1 && (
                    <span className="inspector-count">{selectedNodeIds.size} selected</span>
                  )}
                  <div className="color-swatches" title="Card Background Color">
                    {NODE_BG_COLORS.map((c) => (
                      <button
                        key={c.value}
                        className={`swatch ${selectedNode.color === c.value ? 'swatch-active' : ''}`}
                        style={{
                          backgroundColor: c.value === 'transparent' ? '#1e2024' : c.value,
                        }}
                        title={`Background: ${c.name}`}
                        onClick={() =>
                          applyColorToSelection((n) => {
                            n.color = c.value;
                          })
                        }
                      >
                        {c.value === 'transparent' ? '◌' : ''}
                      </button>
                    ))}
                  </div>

                  <span className="inspector-sep" />

                  <div className="color-swatches" title="Card Text Color">
                    {NODE_TEXT_COLORS.slice(0, 5).map((tc) => (
                      <button
                        key={tc.value}
                        className={`swatch text-swatch ${
                          selectedNodeTextColor === tc.value ? 'swatch-active' : ''
                        }`}
                        style={{ backgroundColor: '#1e2229', color: tc.value }}
                        title={`Text: ${tc.name}`}
                        onClick={() =>
                          applyColorToSelection((n) => {
                            const filtered = n.metadata.tags.filter((t) => !t.startsWith('text:'));
                            filtered.push(`text:${tc.value}`);
                            n.metadata.tags = filtered;
                          })
                        }
                      >
                        A
                      </button>
                    ))}
                  </div>

                  <div className="inspector-btns">
                    <button
                      className="pill-btn-sm"
                      onClick={() => startEditingNode(selectedNode)}
                      title="Edit rich content"
                    >
                      Edit
                    </button>
                    <button
                      className="pill-btn-sm"
                      onClick={() => openOrCreateNestedCanvas(selectedNode.id)}
                      title="Open or create nested sub-canvas"
                    >
                      {selectedNode.nestedMapId ? 'Sub-Map' : '+ Sub-Map'}
                    </button>
                    <button
                      className="pill-btn-sm"
                      onClick={() => attachmentInputRef.current?.click()}
                      title="Attach file"
                    >
                      📎
                    </button>
                    <button
                      className="pill-btn-sm pill-danger"
                      onClick={deleteSelection}
                      title="Delete node (Del)"
                    >
                      🗑
                    </button>
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={handleAttachFile}
                    />
                  </div>
                </div>

                {/* Icon Glyph & Cross-Map Link Row */}
                <div className="inspector-row secondary-row">
                  <div className="icon-picker">
                    {NODE_ICONS.map((ic) => (
                      <button
                        key={ic.id}
                        className={`pill-btn-sm ${activeIconTag === ic.id ? 'pill-primary' : ''}`}
                        onClick={() =>
                          commitMutation((draft) => {
                            const n = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                            if (!n) return;
                            const filtered = n.metadata.tags.filter((t) => !t.startsWith('icon:'));
                            if (ic.id) filtered.push(`icon:${ic.id}`);
                            n.metadata.tags = filtered;
                          })
                        }
                      >
                        {ic.label}
                      </button>
                    ))}
                  </div>

                  <div className="inline-ref-adder">
                    <select
                      className="mini-select"
                      value={refTargetMapId}
                      onChange={(e) => {
                        setRefTargetMapId(e.target.value);
                        setRefTargetNodeId('');
                      }}
                    >
                      <option value="">Link map...</option>
                      {Object.values(workspace.maps).map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title}
                        </option>
                      ))}
                    </select>
                    {refTargetMapId && workspace.maps[refTargetMapId] && (
                      <select
                        className="mini-select"
                        value={refTargetNodeId}
                        onChange={(e) => setRefTargetNodeId(e.target.value)}
                      >
                        <option value="">Node...</option>
                        {Object.values(workspace.maps[refTargetMapId].nodes)
                          .filter((n) => !n.metadata.deletedAt)
                          .map((n) => (
                            <option key={n.id} value={n.id}>
                              {n.title}
                            </option>
                          ))}
                      </select>
                    )}
                    {refTargetNodeId && (
                      <button
                        className="pill-btn-sm pill-primary"
                        onClick={() => {
                          commitMutation((draft) => {
                            const node = draft.maps[draft.activeMapId].nodes[selectedNode.id];
                            const targetNode = draft.maps[refTargetMapId]?.nodes[refTargetNodeId];
                            if (node && targetNode) {
                              node.crossMapRefs.push({
                                id: generateUUID(),
                                targetMapId: refTargetMapId,
                                targetNodeId: refTargetNodeId,
                                label: refLabel.trim() || targetNode.title,
                              });
                            }
                          });
                          setRefLabel('');
                          setRefTargetNodeId('');
                        }}
                      >
                        + Link
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              selectedEdge && (
                <div className="inspector-row">
                  <input
                    className="mini-input"
                    value={editingEdgeId === selectedEdge.id ? edgeLabelDraft : selectedEdge.label}
                    onFocus={() => {
                      setEditingEdgeId(selectedEdge.id);
                      setEdgeLabelDraft(selectedEdge.label);
                    }}
                    onChange={(e) => {
                      const val = e.target.value;
                      setEdgeLabelDraft(val);
                      commitMutation((draft) => {
                        const edge = draft.maps[draft.activeMapId].edges[selectedEdge.id];
                        if (edge) edge.label = val;
                      });
                    }}
                    placeholder="Connection label..."
                  />
                  <button
                    className={`pill-btn-sm ${selectedEdge.style === 'solid' ? 'pill-primary' : ''}`}
                    onClick={() =>
                      commitMutation((draft) => {
                        const edge = draft.maps[draft.activeMapId].edges[selectedEdge.id];
                        if (edge) edge.style = 'solid';
                      })
                    }
                  >
                    Solid
                  </button>
                  <button
                    className={`pill-btn-sm ${selectedEdge.style === 'dashed' ? 'pill-primary' : ''}`}
                    onClick={() =>
                      commitMutation((draft) => {
                        const edge = draft.maps[draft.activeMapId].edges[selectedEdge.id];
                        if (edge) edge.style = 'dashed';
                      })
                    }
                  >
                    Dashed
                  </button>
                  <button className="pill-btn-sm pill-danger" onClick={deleteSelection}>
                    Delete
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* Bottom-Right Radar Overview & Zoom Dock */}
        <div
          className={`right-bottom-cluster ${rightPanelOpen ? 'cluster-shifted' : ''}`}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {minimapData && (
            <div
              className="minimap-radar"
              title="Click anywhere on radar to jump camera"
              onPointerDown={(e) => {
                e.stopPropagation();
                const rect = e.currentTarget.getBoundingClientRect();
                const clickX = e.clientX - rect.left;
                const clickY = e.clientY - rect.top;
                const worldX =
                  (clickX - minimapData.offsetX) / minimapData.scale + minimapData.minX;
                const worldY =
                  (clickY - minimapData.offsetY) / minimapData.scale + minimapData.minY;

                setWorkspace((prev) => {
                  if (!prev) return prev;
                  const next = cloneEnvelope(prev);
                  const m = next.maps[next.activeMapId];
                  if (!m) return prev;
                  const z = m.viewport.zoom;
                  m.viewport.panX = Math.round(viewportSize.w / 2 - worldX * z);
                  m.viewport.panY = Math.round(viewportSize.h / 2 - worldY * z);
                  return next;
                });
              }}
            >
              <svg
                className="minimap-svg"
                viewBox={`0 0 ${minimapData.radarW} ${minimapData.radarH}`}
              >
                {visibleEdges.map((edge) => {
                  const s = activeMap.nodes[edge.sourceId];
                  const t = activeMap.nodes[edge.targetId];
                  if (!s || !t) return null;
                  const x1 =
                    minimapData.offsetX + (s.x + s.width / 2 - minimapData.minX) * minimapData.scale;
                  const y1 =
                    minimapData.offsetY +
                    (s.y + (s.collapsed ? 19 : s.height / 2) - minimapData.minY) *
                      minimapData.scale;
                  const x2 =
                    minimapData.offsetX + (t.x + t.width / 2 - minimapData.minX) * minimapData.scale;
                  const y2 =
                    minimapData.offsetY +
                    (t.y + (t.collapsed ? 19 : t.height / 2) - minimapData.minY) *
                      minimapData.scale;
                  return (
                    <line
                      key={edge.id}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      className="minimap-edge-line"
                    />
                  );
                })}

                {allActiveNodes.map((n) => {
                  const rx = minimapData.offsetX + (n.x - minimapData.minX) * minimapData.scale;
                  const ry = minimapData.offsetY + (n.y - minimapData.minY) * minimapData.scale;
                  const rw = Math.max(4, n.width * minimapData.scale);
                  const rh = Math.max(3, (n.collapsed ? 38 : n.height) * minimapData.scale);
                  return (
                    <rect
                      key={n.id}
                      x={rx}
                      y={ry}
                      width={rw}
                      height={rh}
                      rx={1.5}
                      className={`minimap-node-rect ${
                        n.id === selectedNodeId ? 'minimap-node-selected' : ''
                      }`}
                    />
                  );
                })}

                <rect
                  x={minimapData.viewRect.x}
                  y={minimapData.viewRect.y}
                  width={minimapData.viewRect.w}
                  height={minimapData.viewRect.h}
                  rx={2}
                  className="minimap-viewport-rect"
                />
              </svg>
              <div className="minimap-badge">RADAR · {allActiveNodes.length}</div>
            </div>
          )}

          <div className="zoom-dock">
            <button
              className="zoom-dock-btn"
              onClick={() => applyZoomFactor(1.15)}
              title="Zoom In (Mouse Wheel Up)"
            >
              +
            </button>
            <button
              className="zoom-dock-pct"
              onClick={fitAllNodesInView}
              title="Fit all nodes in view (Shortcut: F)"
            >
              {Math.round(activeMap.viewport.zoom * 100)}%
            </button>
            <button
              className="zoom-dock-btn"
              onClick={() => applyZoomFactor(0.87)}
              title="Zoom Out (Mouse Wheel Down)"
            >
              −
            </button>
          </div>
        </div>

        {/* Right-Click Mouse Context Menu */}
        {contextMenu && (
          <div
            className="context-menu"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {contextMenu.targetNodeId ? (
              <>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    const n = activeMap.nodes[contextMenu.targetNodeId!];
                    if (n) startEditingNode(n);
                    setContextMenu(null);
                  }}
                >
                  Edit Card Content
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    setConnectMode(true);
                    setConnectSourceId(contextMenu.targetNodeId!);
                    setContextMenu(null);
                  }}
                >
                  Connect From Here →
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    openOrCreateNestedCanvas(contextMenu.targetNodeId!);
                    setContextMenu(null);
                  }}
                >
                  Open / Create Sub-Canvas
                </button>
                <button
                  className="context-menu-item context-danger"
                  onClick={() => {
                    setSelectedNodeId(contextMenu.targetNodeId!);
                    deleteSelection();
                    setContextMenu(null);
                  }}
                >
                  Delete Card
                </button>
              </>
            ) : (
              <>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    createNodeAt(contextMenu.worldX, contextMenu.worldY);
                    setContextMenu(null);
                  }}
                >
                  + New Card Here
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    setContextMenu(null);
                    fileImportInputRef.current?.click();
                  }}
                >
                  ↙ Import JSON / Markdown...
                </button>
                <button
                  className="context-menu-item"
                  onClick={() => {
                    fitAllNodesInView();
                    setContextMenu(null);
                  }}
                >
                  Fit All in View (F)
                </button>
                <button
                  className="context-menu-item"
                  disabled={past.length === 0}
                  onClick={() => {
                    undo();
                    setContextMenu(null);
                  }}
                >
                  Undo
                </button>
                <button
                  className="context-menu-item"
                  disabled={future.length === 0}
                  onClick={() => {
                    redo();
                    setContextMenu(null);
                  }}
                >
                  Redo
                </button>
              </>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
