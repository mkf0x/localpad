# Local MindMap (OrgPad-Style Spatial Canvas)

An offline-first, local-hosted spatial knowledge mapping and visual note-taking application inspired by OrgPad, built with React, TypeScript, and Vite.

## Requirements

- **Node.js**: 20 LTS or newer
- **npm**: v10 or newer

## Quick Start

1. Extract the archive and navigate into the directory:
   ```bash
   cd local-mindmap
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
   *(Note: running `npm install` will also generate `package-lock.json` locally.)*
3. Start the local development server:
   ```bash
   npm run dev
   ```
4. Open `http://127.0.0.1:5173` in your browser.

## Architecture & Subsystems

The codebase separates concerns into three decoupled engines:

1. **Graph Engine (`src/App.tsx` & `src/types.ts`)**:
   - Manages persistent UUID-keyed nodes, directed/undirected edges, spatial coordinates (`x`, `y`, `width`, `height`), viewport pan/zoom, and history stack (undo/redo including drag completion).
2. **Document Engine (`src/types.ts` & `src/App.tsx`)**:
   - Structured rich-text block representation (headings, paragraphs, bullet lists, callouts, inline bold/italic/code marks — never raw HTML strings).
   - Multi-map workspace support, nested sub-canvases linked via `nestedMapId`, cross-map node references (`crossMapRefs`), breadcrumb navigation stack, and binary attachment references (`attachmentIds`).
3. **Persistence Engine (`src/storage.ts`)**:
   - Repository abstraction (`WorkspaceRepository`) decoupled from IndexedDB.
   - Explicit `schemaVersion` (v3) independent of application version.
   - Deterministic sequential migration pipeline (`v1 -> v2 -> v3`) that snapshots raw pre-migration payloads into backup storage before transforming.
   - Strict structural validation on JSON import (verifying UUIDs, map references, edge endpoints, and schema compatibility) without overwriting active state on error.
   - Explicit IndexedDB connection lifecycle management (`close()` on unload/teardown) and UI save-status reporting.

## Keyboard & Canvas Controls

- **Double-click canvas** or **`N` / `Enter` (when canvas focused)**: Create a new node
- **Click node / Drag node header**: Select and move node (commits single undo state on drop)
- **Double-click node body**: Edit structured rich-text blocks, attachments, nested sub-map, or cross-map references
- **`Connect` mode (`C`)**: Click source node, then click destination node to create an edge
- **`Delete` / `Backspace` (when not editing text)**: Delete selected node or edge
- **`Ctrl/Cmd + Z`**: Undo
- **`Ctrl/Cmd + Y` or `Ctrl/Cmd + Shift + Z`**: Redo
- **`Mouse Wheel`**: Zoom smoothly in and out around cursor
- **Background Drag**: Pan canvas
- **`↙ IMPORT` button or Drag & Drop file onto canvas**: Import versioned `.json` workspace backups or `.md` / `.txt` outlines
