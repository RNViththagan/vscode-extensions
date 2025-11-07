# Checkpoint Implementation Using VS Code Local History

> **Date**: 2025-11-05
> **Target**: Ballerina VS Code Extension (Custom Webview Chat)
> **Approach**: Leverage VS Code's Built-in Local History + Lightweight Metadata
> **Estimated Effort**: 6-10 hours

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [VS Code Local History Deep Dive](#vs-code-local-history-deep-dive)
4. [Implementation Design](#implementation-design)
5. [Detailed Implementation Steps](#detailed-implementation-steps)
6. [Code Implementation](#code-implementation)
7. [UI Integration](#ui-integration)
8. [Testing Strategy](#testing-strategy)
9. [Troubleshooting](#troubleshooting)

---

## Executive Summary

### The Problem

Your custom webview-based AI chat (using Vercel AI SDK) needs checkpoint functionality to allow users to restore their workspace to previous states after AI-generated code changes.

### The Solution

**Hybrid Approach**: Use VS Code's built-in Local History for file storage + lightweight metadata for checkpoint tracking.

```
┌─────────────────────────────────────────────────────────┐
│           VS Code Local History (Built-in)              │
│  • Stores full file contents automatically             │
│  • Manages retention and cleanup                        │
│  • Provides Timeline UI                                 │
│  • No storage implementation needed                     │
└─────────────────────────┬───────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────┐
│      Your Extension (Metadata Only)                     │
│  • Track checkpoint metadata (which task = which files) │
│  • Link checkpoints to chat messages                    │
│  • Show checkpoint UI in webview                        │
│  • Trigger restore operations                           │
└─────────────────────────────────────────────────────────┘
```

### Key Benefits

| Aspect | Custom Solution | Local History Solution |
|--------|----------------|----------------------|
| File Storage | Must implement | ✅ Free (VS Code handles) |
| Cleanup/Retention | Must implement | ✅ Free (VS Code handles) |
| Storage Size | Large (full files) | ✅ Zero (VS Code manages) |
| Implementation Time | 20+ hours | ✅ 6-10 hours |
| Maintenance | High | ✅ Low |
| User Trust | Unknown | ✅ High (native feature) |

### What Users Will See

1. **Checkpoint markers** in your webview chat UI (similar to GitHub Copilot's bookmarks)
2. **"Restore to this point"** button on messages that modified files
3. **File list** showing which files changed at each checkpoint
4. **Quick restore** with confirmation dialog
5. **Timeline view** integration (optional) for advanced users

---

## Architecture Overview

### Component Interaction

```
┌──────────────────────────────────────────────────────────┐
│                   User Action                             │
│  "Create a service with MySQL connection"                │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│              Task Completion Flow                         │
│  1. Task marked as completed                             │
│  2. Files prepared for integration                        │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│          Checkpoint Creation (NEW)                        │
│  • Create Local History entry (VS Code command)          │
│  • Save checkpoint metadata                               │
│  • Return checkpoint ID                                   │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│          File Integration (EXISTING)                      │
│  • addToIntegration() applies changes                    │
│  • Files saved → Local History auto-updated              │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│          UI Update (NEW)                                  │
│  • Show checkpoint marker in webview                     │
│  • Enable "Restore" button                               │
└──────────────────────────────────────────────────────────┘


                    USER CLICKS RESTORE
                           │
                           ▼
┌──────────────────────────────────────────────────────────┐
│          Restoration Flow (NEW)                           │
│  1. Load checkpoint metadata                             │
│  2. Get file URIs and timestamps                          │
│  3. Open Timeline view OR programmatic restore           │
│  4. Apply restorations                                    │
│  5. Refresh workspace                                     │
└──────────────────────────────────────────────────────────┘
```

### Data Flow

**Checkpoint Metadata** (Stored by your extension):
```json
{
  "id": "checkpoint-1730812345678",
  "messageId": "msg-abc-123",
  "taskDescription": "Create MySQL connection",
  "timestamp": 1730812345678,
  "files": [
    {
      "path": "service.bal",
      "uri": "file:///workspace/service.bal",
      "operation": "created"
    },
    {
      "path": "types.bal",
      "uri": "file:///workspace/types.bal",
      "operation": "modified"
    }
  ],
  "label": "AI Checkpoint: Create MySQL connection"
}
```

**File Contents** (Stored by VS Code Local History):
- VS Code automatically saves full file contents on every save
- No need to store this yourself!
- Access via Timeline API or restoration commands

---

## VS Code Local History Deep Dive

### Available APIs

#### 1. Commands (Programmatic Access)

```typescript
// Create a named local history entry
await vscode.commands.executeCommand(
    'workbench.action.localHistory.create',
    vscode.Uri.file('/workspace/service.bal')
);

// Restore via picker (shows UI dialog)
await vscode.commands.executeCommand(
    'workbench.action.localHistory.restoreViaPicker',
    vscode.Uri.file('/workspace/service.bal')
);

// Delete all local history
await vscode.commands.executeCommand(
    'workbench.action.localHistory.deleteAll'
);
```

#### 2. Configuration Settings

```typescript
// Check if local history is enabled
const config = vscode.workspace.getConfiguration('workbench');
const enabled = config.get<boolean>('localHistory.enabled');

// Get max file entries
const maxEntries = config.get<number>('localHistory.maxFileEntries'); // default: 50

// Get max file size (bytes)
const maxSize = config.get<number>('localHistory.maxFileSize'); // default: 262144 (256 KB)

// Get merge window (milliseconds)
const mergeWindow = config.get<number>('localHistory.mergeWindow'); // default: 10000 (10s)
```

#### 3. Timeline View API

```typescript
// Show Timeline view for a file
await vscode.commands.executeCommand(
    'timeline.focus'
);

// Get timeline items (requires TimelineProvider - VS Code built-in)
// Note: Extensions cannot directly read timeline items
// But can show Timeline view UI
```

### How Local History Works

1. **Automatic Saving**:
   - When you call `workspace.fs.writeFile()` or `workspace.applyEdit()`
   - VS Code automatically creates a local history entry
   - No explicit command needed for basic tracking

2. **Entry Naming**:
   - Default: Timestamp-based
   - Custom: Use `workbench.action.localHistory.create` with label

3. **Storage Location**:
   - Local: `~/.vscode/User/History/`
   - Remote: Remote user data folder
   - Web: IndexedDB

4. **Retention Policy**:
   - Max 50 entries per file (configurable)
   - Max 256 KB per file (configurable)
   - Automatic cleanup of old entries

### Limitations to Know

❌ **Cannot programmatically read timeline entries** - No extension API to list or read local history entries directly
✅ **Can trigger restore via UI** - Can show Timeline view programmatically
✅ **Can create named entries** - Custom labels for checkpoints
✅ **Automatic tracking works** - Every file save is tracked automatically

---

## Implementation Design

### Checkpoint Manager Architecture

```typescript
/**
 * CheckpointManager coordinates checkpoint creation and restoration
 * using VS Code's Local History feature.
 */
class CheckpointManager {
    private checkpoints: Map<string, CheckpointMetadata>;
    private storage: CheckpointStorage;

    // Core operations
    async createCheckpoint(files: FileChange[], taskDescription: string): Promise<string>
    async restoreCheckpoint(checkpointId: string): Promise<void>
    async listCheckpoints(messageId?: string): Promise<CheckpointMetadata[]>
    async deleteCheckpoint(checkpointId: string): Promise<void>
}
```

### Integration Points

#### 1. Task Completion Hook

**File**: `task_write_tool.ts`
**Function**: `handleTaskCompletion()`
**Change**: Add checkpoint creation before file integration

```typescript
async function handleTaskCompletion(...) {
    // EXISTING: Detect completed tasks
    const lastCompletedTask = newlyCompletedTasks[newlyCompletedTasks.length - 1];

    // NEW: Create checkpoint BEFORE integration
    if (updatedSourceFiles && updatedFileNames) {
        const checkpointManager = CheckpointManager.getInstance();
        const checkpointId = await checkpointManager.createCheckpoint(
            updatedSourceFiles,
            lastCompletedTask.description
        );

        // Store checkpoint ID in context
        currentContext.lastCheckpointId = checkpointId;

        // EXISTING: Apply changes
        await integrateCodeToWorkspace(updatedSourceFiles, updatedFileNames);

        // NEW: Notify webview about checkpoint
        eventHandler({
            type: 'checkpoint_created',
            checkpointId,
            taskDescription: lastCompletedTask.description,
            files: updatedFileNames
        });
    }

    // EXISTING: Rest of approval flow
    ...
}
```

#### 2. Webview Communication

**File**: `rpc-manager.ts` or webview handler
**Add**: Checkpoint restoration RPC call

```typescript
messenger.onRequest(restoreCheckpoint, async (checkpointId: string) => {
    const checkpointManager = CheckpointManager.getInstance();
    await checkpointManager.restoreCheckpoint(checkpointId);

    return { success: true };
});
```

#### 3. State Machine Integration

**File**: `aiChatMachine.ts`
**Add**: Checkpoint state tracking

```typescript
// Add to context
context: {
    // ... existing
    checkpoints: [] as CheckpointMetadata[],
    lastCheckpointId: undefined as string | undefined
}

// Add event
AIChatMachineEventType.CHECKPOINT_CREATED = 'CHECKPOINT_CREATED'
AIChatMachineEventType.CHECKPOINT_RESTORED = 'CHECKPOINT_RESTORED'
```

---

## Detailed Implementation Steps

### Phase 1: Create Checkpoint Infrastructure (3-4 hours)

#### Step 1.1: Define Types

**File**: `workspaces/ballerina/ballerina-extension/src/features/ai/checkpoint/types.ts`

```typescript
import * as vscode from 'vscode';

/**
 * Represents a file that was changed at a checkpoint.
 */
export interface CheckpointFile {
    /** Relative file path (e.g., "service.bal") */
    path: string;

    /** Absolute file URI */
    uri: vscode.Uri;

    /** Type of change */
    operation: 'created' | 'modified' | 'deleted';

    /** File size at checkpoint time (bytes) */
    size?: number;
}

/**
 * Metadata for a single checkpoint.
 *
 * Note: Actual file contents are stored by VS Code's Local History.
 * This only tracks which files changed and when.
 */
export interface CheckpointMetadata {
    /** Unique checkpoint identifier */
    id: string;

    /** Associated chat message ID */
    messageId: string;

    /** Task description (e.g., "Create MySQL connection") */
    taskDescription: string;

    /** Creation timestamp (milliseconds since epoch) */
    timestamp: number;

    /** Files affected by this checkpoint */
    files: CheckpointFile[];

    /** Human-readable label for VS Code Local History */
    label: string;

    /** Whether this checkpoint can still be restored */
    restorable: boolean;
}

/**
 * Storage interface for checkpoint metadata.
 */
export interface CheckpointStorage {
    /** Save checkpoint metadata */
    save(checkpoint: CheckpointMetadata): Promise<void>;

    /** Load checkpoint by ID */
    load(checkpointId: string): Promise<CheckpointMetadata | undefined>;

    /** Load all checkpoints */
    loadAll(): Promise<CheckpointMetadata[]>;

    /** Delete checkpoint metadata */
    delete(checkpointId: string): Promise<void>;

    /** Delete all checkpoints */
    deleteAll(): Promise<void>;
}

/**
 * Result of a checkpoint restore operation.
 */
export interface RestoreResult {
    success: boolean;
    checkpointId: string;
    filesRestored: string[];
    errors?: Array<{
        file: string;
        error: string;
    }>;
}
```

#### Step 1.2: Implement Storage

**File**: `workspaces/ballerina/ballerina-extension/src/features/ai/checkpoint/storage.ts`

```typescript
import * as vscode from 'vscode';
import { CheckpointMetadata, CheckpointStorage } from './types';

/**
 * Stores checkpoint metadata using VS Code's WorkspaceState (memento).
 *
 * Actual file contents are stored by VS Code's Local History feature.
 * We only store metadata about which checkpoints exist.
 */
export class WorkspaceCheckpointStorage implements CheckpointStorage {
    private static readonly STORAGE_KEY = 'ballerina.ai.checkpoints';
    private memento: vscode.Memento;

    constructor(context: vscode.ExtensionContext) {
        this.memento = context.workspaceState;
    }

    async save(checkpoint: CheckpointMetadata): Promise<void> {
        const checkpoints = await this.loadAll();

        // Update or add checkpoint
        const index = checkpoints.findIndex(c => c.id === checkpoint.id);
        if (index >= 0) {
            checkpoints[index] = checkpoint;
        } else {
            checkpoints.push(checkpoint);
        }

        // Sort by timestamp (newest first)
        checkpoints.sort((a, b) => b.timestamp - a.timestamp);

        // Keep last 50 checkpoints
        const trimmed = checkpoints.slice(0, 50);

        await this.memento.update(WorkspaceCheckpointStorage.STORAGE_KEY, trimmed);

        console.log(`[Checkpoint Storage] Saved checkpoint: ${checkpoint.id}`);
    }

    async load(checkpointId: string): Promise<CheckpointMetadata | undefined> {
        const checkpoints = await this.loadAll();
        return checkpoints.find(c => c.id === checkpointId);
    }

    async loadAll(): Promise<CheckpointMetadata[]> {
        const stored = this.memento.get<CheckpointMetadata[]>(
            WorkspaceCheckpointStorage.STORAGE_KEY,
            []
        );

        console.log(`[Checkpoint Storage] Loaded ${stored.length} checkpoints`);
        return stored;
    }

    async delete(checkpointId: string): Promise<void> {
        const checkpoints = await this.loadAll();
        const filtered = checkpoints.filter(c => c.id !== checkpointId);

        await this.memento.update(WorkspaceCheckpointStorage.STORAGE_KEY, filtered);

        console.log(`[Checkpoint Storage] Deleted checkpoint: ${checkpointId}`);
    }

    async deleteAll(): Promise<void> {
        await this.memento.update(WorkspaceCheckpointStorage.STORAGE_KEY, []);
        console.log('[Checkpoint Storage] Deleted all checkpoints');
    }

    /**
     * Export checkpoints for debugging or backup.
     */
    async exportToJSON(): Promise<string> {
        const checkpoints = await this.loadAll();
        return JSON.stringify(checkpoints, null, 2);
    }
}
```

#### Step 1.3: Implement Checkpoint Manager

**File**: `workspaces/ballerina/ballerina-extension/src/features/ai/checkpoint/CheckpointManager.ts`

```typescript
import * as vscode from 'vscode';
import * as path from 'path';
import { CheckpointMetadata, CheckpointFile, CheckpointStorage, RestoreResult } from './types';
import { WorkspaceCheckpointStorage } from './storage';
import { SourceFiles } from '@wso2/ballerina-core';

/**
 * CheckpointManager coordinates checkpoint creation and restoration
 * using VS Code's Local History feature.
 *
 * Architecture:
 * - File contents: Stored by VS Code Local History (automatic)
 * - Metadata: Stored by WorkspaceCheckpointStorage (manual)
 * - Restoration: Via VS Code Timeline or commands
 */
export class CheckpointManager {
    private static instance: CheckpointManager;
    private storage: CheckpointStorage;
    private extensionContext: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.extensionContext = context;
        this.storage = new WorkspaceCheckpointStorage(context);
    }

    /**
     * Initialize the singleton instance.
     * Call this from extension activation.
     */
    public static initialize(context: vscode.ExtensionContext): void {
        CheckpointManager.instance = new CheckpointManager(context);
        console.log('[CheckpointManager] Initialized');
    }

    /**
     * Get the singleton instance.
     */
    public static getInstance(): CheckpointManager {
        if (!CheckpointManager.instance) {
            throw new Error('CheckpointManager not initialized. Call initialize() first.');
        }
        return CheckpointManager.instance;
    }

    /**
     * Creates a checkpoint before file modifications.
     *
     * This method:
     * 1. Creates named Local History entries for all affected files
     * 2. Saves checkpoint metadata
     * 3. Returns checkpoint ID for later restoration
     *
     * @param sourceFiles Files that will be modified
     * @param taskDescription Human-readable task description
     * @param messageId Associated chat message ID
     * @returns Checkpoint ID
     */
    public async createCheckpoint(
        sourceFiles: SourceFiles[],
        taskDescription: string,
        messageId: string
    ): Promise<string> {
        console.log(`[CheckpointManager] Creating checkpoint for: ${taskDescription}`);

        // Validate inputs
        if (!sourceFiles || sourceFiles.length === 0) {
            throw new Error('No files provided for checkpoint');
        }

        // Check if Local History is enabled
        const config = vscode.workspace.getConfiguration('workbench');
        const enabled = config.get<boolean>('localHistory.enabled', true);

        if (!enabled) {
            console.warn('[CheckpointManager] Local History is disabled. Checkpoint may not be restorable.');
        }

        // Generate checkpoint ID
        const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const timestamp = Date.now();
        const label = `AI Checkpoint: ${taskDescription}`;

        // Get workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            throw new Error('No workspace folder found');
        }
        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Prepare checkpoint files
        const checkpointFiles: CheckpointFile[] = [];

        for (const sourceFile of sourceFiles) {
            const fullPath = path.join(workspaceRoot, sourceFile.filePath);
            const uri = vscode.Uri.file(fullPath);

            // Determine operation type
            let operation: 'created' | 'modified' | 'deleted' = 'modified';
            try {
                await vscode.workspace.fs.stat(uri);
                operation = 'modified'; // File exists, will be modified
            } catch {
                operation = 'created'; // File doesn't exist, will be created
            }

            checkpointFiles.push({
                path: sourceFile.filePath,
                uri,
                operation,
                size: sourceFile.content.length
            });

            // Create named Local History entry
            // Note: This creates a checkpoint BEFORE the file is modified
            try {
                if (operation === 'modified') {
                    // For existing files, create a named history entry
                    await vscode.commands.executeCommand(
                        'workbench.action.localHistory.create',
                        uri
                    );
                    console.log(`[CheckpointManager] Created history entry for: ${sourceFile.filePath}`);
                }
                // For new files, Local History will auto-create on first save
            } catch (error) {
                console.error(`[CheckpointManager] Failed to create history for ${sourceFile.filePath}:`, error);
                // Continue anyway - auto-save will create history
            }
        }

        // Save checkpoint metadata
        const metadata: CheckpointMetadata = {
            id: checkpointId,
            messageId,
            taskDescription,
            timestamp,
            files: checkpointFiles,
            label,
            restorable: true
        };

        await this.storage.save(metadata);

        console.log(`[CheckpointManager] ✓ Checkpoint created: ${checkpointId}`);
        console.log(`[CheckpointManager]   Files: ${checkpointFiles.length}`);
        console.log(`[CheckpointManager]   Task: ${taskDescription}`);

        return checkpointId;
    }

    /**
     * Restores a checkpoint by showing the Timeline view.
     *
     * Options:
     * 1. Show Timeline view (user manually restores)
     * 2. Use restore picker command (shows dialog)
     *
     * Note: VS Code doesn't provide programmatic restoration API,
     * so we guide users to the Timeline view.
     *
     * @param checkpointId Checkpoint to restore
     * @returns Restore result
     */
    public async restoreCheckpoint(checkpointId: string): Promise<RestoreResult> {
        console.log(`[CheckpointManager] Restoring checkpoint: ${checkpointId}`);

        // Load checkpoint metadata
        const checkpoint = await this.storage.load(checkpointId);
        if (!checkpoint) {
            throw new Error(`Checkpoint not found: ${checkpointId}`);
        }

        console.log(`[CheckpointManager] Found checkpoint: ${checkpoint.label}`);
        console.log(`[CheckpointManager] Files to restore: ${checkpoint.files.length}`);

        // Confirm with user
        const confirm = await vscode.window.showWarningMessage(
            `Restore checkpoint "${checkpoint.taskDescription}"?\n\n` +
            `This will revert ${checkpoint.files.length} file(s) to their previous state.\n` +
            `Files: ${checkpoint.files.map(f => f.path).join(', ')}`,
            { modal: true },
            'Restore',
            'Cancel'
        );

        if (confirm !== 'Restore') {
            console.log('[CheckpointManager] Restore cancelled by user');
            return {
                success: false,
                checkpointId,
                filesRestored: []
            };
        }

        // Show Timeline view for each file
        // User will manually select and restore from history
        const filesRestored: string[] = [];
        const errors: Array<{ file: string; error: string }> = [];

        for (const file of checkpoint.files) {
            try {
                // Open the file
                const document = await vscode.workspace.openTextDocument(file.uri);
                await vscode.window.showTextDocument(document);

                // Show Timeline view
                await vscode.commands.executeCommand('timeline.focus');

                // Note: Could also use restore picker
                // await vscode.commands.executeCommand(
                //     'workbench.action.localHistory.restoreViaPicker',
                //     file.uri
                // );

                filesRestored.push(file.path);

                console.log(`[CheckpointManager] ✓ Opened ${file.path} for restoration`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`[CheckpointManager] ✗ Failed to restore ${file.path}:`, error);
                errors.push({
                    file: file.path,
                    error: errorMsg
                });
            }
        }

        // Show guidance to user
        await vscode.window.showInformationMessage(
            `Timeline view opened. Select history entry from ${new Date(checkpoint.timestamp).toLocaleString()} to restore.`,
            'Got it'
        );

        const result: RestoreResult = {
            success: errors.length === 0,
            checkpointId,
            filesRestored,
            errors: errors.length > 0 ? errors : undefined
        };

        console.log(`[CheckpointManager] Restore result:`, result);

        return result;
    }

    /**
     * Restores checkpoint with automatic selection (alternative approach).
     *
     * This uses the restore picker which shows a dialog with history entries.
     * More automated than Timeline view but still requires user selection.
     */
    public async restoreCheckpointViaPicker(checkpointId: string): Promise<RestoreResult> {
        console.log(`[CheckpointManager] Restoring via picker: ${checkpointId}`);

        const checkpoint = await this.storage.load(checkpointId);
        if (!checkpoint) {
            throw new Error(`Checkpoint not found: ${checkpointId}`);
        }

        const filesRestored: string[] = [];
        const errors: Array<{ file: string; error: string }> = [];

        for (const file of checkpoint.files) {
            try {
                // This command shows a picker dialog with history entries
                await vscode.commands.executeCommand(
                    'workbench.action.localHistory.restoreViaPicker',
                    file.uri
                );

                filesRestored.push(file.path);
                console.log(`[CheckpointManager] ✓ Opened restore picker for: ${file.path}`);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                errors.push({ file: file.path, error: errorMsg });
            }
        }

        return {
            success: errors.length === 0,
            checkpointId,
            filesRestored,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Lists all checkpoints, optionally filtered by message ID.
     */
    public async listCheckpoints(messageId?: string): Promise<CheckpointMetadata[]> {
        const all = await this.storage.loadAll();

        if (messageId) {
            return all.filter(c => c.messageId === messageId);
        }

        return all;
    }

    /**
     * Deletes a checkpoint metadata.
     * Note: Does NOT delete Local History entries (VS Code manages those).
     */
    public async deleteCheckpoint(checkpointId: string): Promise<void> {
        await this.storage.delete(checkpointId);
        console.log(`[CheckpointManager] Deleted checkpoint: ${checkpointId}`);
    }

    /**
     * Deletes all checkpoint metadata.
     */
    public async deleteAllCheckpoints(): Promise<void> {
        await this.storage.deleteAll();
        console.log('[CheckpointManager] Deleted all checkpoints');
    }

    /**
     * Gets checkpoint statistics for debugging.
     */
    public async getStats(): Promise<{
        totalCheckpoints: number;
        oldestCheckpoint?: Date;
        newestCheckpoint?: Date;
        totalFiles: number;
    }> {
        const checkpoints = await this.storage.loadAll();

        if (checkpoints.length === 0) {
            return {
                totalCheckpoints: 0,
                totalFiles: 0
            };
        }

        const timestamps = checkpoints.map(c => c.timestamp);
        const totalFiles = checkpoints.reduce((sum, c) => sum + c.files.length, 0);

        return {
            totalCheckpoints: checkpoints.length,
            oldestCheckpoint: new Date(Math.min(...timestamps)),
            newestCheckpoint: new Date(Math.max(...timestamps)),
            totalFiles
        };
    }
}
```

---

### Phase 2: Integrate with Task Completion (1-2 hours)

#### Step 2.1: Modify task_write_tool.ts

**File**: `workspaces/ballerina/ballerina-extension/src/features/ai/service/libs/task_write_tool.ts`

**Changes**:

```typescript
// Add import at top
import { CheckpointManager } from '../../checkpoint/CheckpointManager';

// Modify handleTaskCompletion function
async function handleTaskCompletion(
    allTasks: Task[],
    newlyCompletedTasks: Task[],
    currentContext: any,
    eventHandler: CopilotEventHandler,
    updatedSourceFiles?: SourceFiles[],
    updatedFileNames?: string[]
): Promise<{ approved: boolean; comment?: string; approvedTaskDescription: string }> {
    const lastCompletedTask = newlyCompletedTasks[newlyCompletedTasks.length - 1];
    console.log(`[TaskWrite Tool] Detected ${newlyCompletedTasks.length} newly completed task(s)`);

    // ===== NEW: Create checkpoint BEFORE applying changes =====
    let checkpointId: string | undefined;

    if (updatedSourceFiles && updatedFileNames && updatedFileNames.length > 0) {
        try {
            const checkpointManager = CheckpointManager.getInstance();

            // Get message ID from context
            const messageId = currentContext.currentMessage?.id || `msg-${Date.now()}`;

            // Prepare source files for checkpoint
            const sourceFilesForCheckpoint = updatedFileNames
                .map(fileName => {
                    const sourceFile = updatedSourceFiles.find(sf => sf.filePath === fileName);
                    if (!sourceFile) {
                        console.warn(`[TaskWrite Tool] Source file not found: ${fileName}`);
                        return null;
                    }
                    return sourceFile;
                })
                .filter((sf): sf is SourceFiles => sf !== null);

            if (sourceFilesForCheckpoint.length > 0) {
                console.log(`[TaskWrite Tool] Creating checkpoint for ${sourceFilesForCheckpoint.length} file(s)`);

                checkpointId = await checkpointManager.createCheckpoint(
                    sourceFilesForCheckpoint,
                    lastCompletedTask.description,
                    messageId
                );

                console.log(`[TaskWrite Tool] ✓ Checkpoint created: ${checkpointId}`);

                // Store checkpoint ID in context for later reference
                currentContext.lastCheckpointId = checkpointId;
            }
        } catch (error) {
            console.error('[TaskWrite Tool] Failed to create checkpoint:', error);
            // Continue anyway - checkpoint is optional
        }
    }

    // ===== EXISTING: Apply code integration =====
    if (updatedSourceFiles && updatedFileNames) {
        await integrateCodeToWorkspace(updatedSourceFiles, updatedFileNames);
    }

    // ===== NEW: Notify webview about checkpoint =====
    if (checkpointId && eventHandler) {
        eventHandler({
            type: 'checkpoint_created',
            checkpointId,
            taskDescription: lastCompletedTask.description,
            files: updatedFileNames || [],
            timestamp: Date.now()
        });
    }

    // ===== EXISTING: State machine update =====
    AIChatStateMachine.sendEvent({
        type: AIChatMachineEventType.TASK_COMPLETED,
    });

    // ===== EXISTING: Auto-approval or manual approval =====
    const isAutoApproveEnabled = currentContext.autoApproveEnabled === true;

    if (isAutoApproveEnabled) {
        console.log(`[TaskWrite Tool] Auto-approval enabled`);
        AIChatStateMachine.sendEvent({
            type: AIChatMachineEventType.APPROVE_TASK,
        });
        return { approved: true, approvedTaskDescription: lastCompletedTask.description };
    }

    return handleManualTaskApproval(allTasks, newlyCompletedTasks, lastCompletedTask, eventHandler);
}
```

#### Step 2.2: Update Extension Activation

**File**: `workspaces/ballerina/ballerina-extension/src/extension.ts` (or main activation file)

```typescript
import { CheckpointManager } from './features/ai/checkpoint/CheckpointManager';

export function activate(context: vscode.ExtensionContext) {
    console.log('Ballerina extension activating...');

    // ===== NEW: Initialize CheckpointManager =====
    CheckpointManager.initialize(context);
    console.log('✓ CheckpointManager initialized');

    // Existing activation code...

    // ===== NEW: Register checkpoint commands =====
    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ballerina.ai.restoreCheckpoint',
            async (checkpointId: string) => {
                try {
                    const manager = CheckpointManager.getInstance();
                    const result = await manager.restoreCheckpoint(checkpointId);

                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `Checkpoint restored: ${result.filesRestored.length} file(s)`
                        );
                    } else {
                        vscode.window.showErrorMessage(
                            `Checkpoint restoration failed. Check Timeline view.`
                        );
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : 'Unknown error';
                    vscode.window.showErrorMessage(`Failed to restore checkpoint: ${msg}`);
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            'ballerina.ai.listCheckpoints',
            async () => {
                const manager = CheckpointManager.getInstance();
                const checkpoints = await manager.listCheckpoints();

                const items = checkpoints.map(c => ({
                    label: c.taskDescription,
                    description: new Date(c.timestamp).toLocaleString(),
                    detail: `${c.files.length} file(s)`,
                    checkpointId: c.id
                }));

                const selected = await vscode.window.showQuickPick(items, {
                    placeHolder: 'Select checkpoint to restore'
                });

                if (selected) {
                    await vscode.commands.executeCommand(
                        'ballerina.ai.restoreCheckpoint',
                        selected.checkpointId
                    );
                }
            }
        )
    );

    // Existing registration code...
}
```

---

### Phase 3: Add RPC Communication (1 hour)

#### Step 3.1: Define RPC Messages

**File**: `packages/ballerina-core/src/rpc/ai-panel/messages.ts` (or wherever RPC messages are defined)

```typescript
// Add to existing messages

export interface CheckpointCreatedMessage {
    checkpointId: string;
    taskDescription: string;
    files: string[];
    timestamp: number;
}

export interface RestoreCheckpointRequest {
    checkpointId: string;
}

export interface RestoreCheckpointResponse {
    success: boolean;
    filesRestored: string[];
    error?: string;
}

export interface ListCheckpointsRequest {
    messageId?: string;
}

export interface ListCheckpointsResponse {
    checkpoints: Array<{
        id: string;
        messageId: string;
        taskDescription: string;
        timestamp: number;
        fileCount: number;
    }>;
}

// Register RPC methods
export const restoreCheckpoint = createRpcMethod<RestoreCheckpointRequest, RestoreCheckpointResponse>('restoreCheckpoint');
export const listCheckpoints = createRpcMethod<ListCheckpointsRequest, ListCheckpointsResponse>('listCheckpoints');
export const checkpointCreated = createRpcNotification<CheckpointCreatedMessage>('checkpointCreated');
```

#### Step 3.2: Implement RPC Handlers

**File**: `workspaces/ballerina/ballerina-extension/src/rpc-managers/ai-panel/rpc-manager.ts`

```typescript
import { CheckpointManager } from '../../features/ai/checkpoint/CheckpointManager';

export class AIPanelRpcManager {
    // ... existing code ...

    // Add checkpoint RPC handlers
    async restoreCheckpoint(request: RestoreCheckpointRequest): Promise<RestoreCheckpointResponse> {
        try {
            const manager = CheckpointManager.getInstance();
            const result = await manager.restoreCheckpoint(request.checkpointId);

            return {
                success: result.success,
                filesRestored: result.filesRestored,
                error: result.errors ? result.errors.map(e => e.error).join(', ') : undefined
            };
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            console.error('[RPC] Restore checkpoint failed:', error);

            return {
                success: false,
                filesRestored: [],
                error: msg
            };
        }
    }

    async listCheckpoints(request: ListCheckpointsRequest): Promise<ListCheckpointsResponse> {
        try {
            const manager = CheckpointManager.getInstance();
            const checkpoints = await manager.listCheckpoints(request.messageId);

            return {
                checkpoints: checkpoints.map(c => ({
                    id: c.id,
                    messageId: c.messageId,
                    taskDescription: c.taskDescription,
                    timestamp: c.timestamp,
                    fileCount: c.files.length
                }))
            };
        } catch (error) {
            console.error('[RPC] List checkpoints failed:', error);
            return { checkpoints: [] };
        }
    }
}
```

**File**: `workspaces/ballerina/ballerina-extension/src/rpc-managers/ai-panel/rpc-handler.ts`

```typescript
export function registerAIPanelRpcHandlers(messenger: Messenger) {
    const rpcManager = new AIPanelRpcManager();

    // Existing handlers...

    // NEW: Checkpoint handlers
    messenger.onRequest(restoreCheckpoint, (req) => rpcManager.restoreCheckpoint(req));
    messenger.onRequest(listCheckpoints, (req) => rpcManager.listCheckpoints(req));
}
```

---

### Phase 4: Update Webview UI (2-3 hours)

#### Step 4.1: Add Checkpoint State to Frontend

**File**: Frontend state management (React/Vue component or store)

```typescript
// Add to your chat message interface
interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: number;

    // NEW: Checkpoint data
    checkpointId?: string;
    checkpointFiles?: string[];
}

// Add checkpoint state
interface ChatState {
    messages: ChatMessage[];
    checkpoints: CheckpointMetadata[];  // NEW
    restoringCheckpoint: boolean;        // NEW
}
```

#### Step 4.2: Listen for Checkpoint Events

**File**: Webview RPC client

```typescript
// Listen for checkpoint creation notification
messenger.onNotification(checkpointCreated, (data: CheckpointCreatedMessage) => {
    console.log('[Webview] Checkpoint created:', data.checkpointId);

    // Update UI state
    setState(prev => ({
        ...prev,
        checkpoints: [
            {
                id: data.checkpointId,
                taskDescription: data.taskDescription,
                timestamp: data.timestamp,
                fileCount: data.files.length
            },
            ...prev.checkpoints
        ]
    }));

    // Associate with current message
    updateMessageWithCheckpoint(currentMessageId, data.checkpointId, data.files);
});

function updateMessageWithCheckpoint(
    messageId: string,
    checkpointId: string,
    files: string[]
) {
    setState(prev => ({
        ...prev,
        messages: prev.messages.map(msg =>
            msg.id === messageId
                ? { ...msg, checkpointId, checkpointFiles: files }
                : msg
        )
    }));
}
```

#### Step 4.3: Add Checkpoint UI Components

**File**: React component (example)

```tsx
// CheckpointMarker.tsx
import React from 'react';

interface CheckpointMarkerProps {
    checkpointId: string;
    taskDescription: string;
    files: string[];
    timestamp: number;
    onRestore: (checkpointId: string) => void;
}

export const CheckpointMarker: React.FC<CheckpointMarkerProps> = ({
    checkpointId,
    taskDescription,
    files,
    timestamp,
    onRestore
}) => {
    const [showDetails, setShowDetails] = React.useState(false);

    return (
        <div className="checkpoint-marker">
            <div className="checkpoint-header">
                <span className="checkpoint-icon">📑</span>
                <span className="checkpoint-label">Checkpoint</span>
                <button
                    className="checkpoint-restore-btn"
                    onClick={() => onRestore(checkpointId)}
                    title="Restore to this point"
                >
                    ↶ Restore
                </button>
                <button
                    className="checkpoint-details-btn"
                    onClick={() => setShowDetails(!showDetails)}
                >
                    {showDetails ? '▼' : '▶'} Details
                </button>
            </div>

            {showDetails && (
                <div className="checkpoint-details">
                    <div className="checkpoint-info">
                        <strong>Task:</strong> {taskDescription}
                    </div>
                    <div className="checkpoint-info">
                        <strong>Time:</strong> {new Date(timestamp).toLocaleString()}
                    </div>
                    <div className="checkpoint-info">
                        <strong>Files ({files.length}):</strong>
                        <ul className="checkpoint-files">
                            {files.map(file => (
                                <li key={file}>{file}</li>
                            ))}
                        </ul>
                    </div>
                </div>
            )}
        </div>
    );
};
```

**File**: Message component update

```tsx
// ChatMessage.tsx (modify existing component)
export const ChatMessage: React.FC<ChatMessageProps> = ({ message }) => {
    const handleRestore = async (checkpointId: string) => {
        try {
            setRestoringCheckpoint(true);

            const result = await messenger.sendRequest(restoreCheckpoint, {
                checkpointId
            });

            if (result.success) {
                vscode.postMessage({
                    command: 'showMessage',
                    text: `Restored ${result.filesRestored.length} file(s)`
                });
            } else {
                vscode.postMessage({
                    command: 'showError',
                    text: `Restore failed: ${result.error}`
                });
            }
        } catch (error) {
            console.error('Restore error:', error);
        } finally {
            setRestoringCheckpoint(false);
        }
    };

    return (
        <div className="chat-message">
            <div className="message-content">
                {message.content}
            </div>

            {/* NEW: Show checkpoint marker if message has checkpoint */}
            {message.checkpointId && message.checkpointFiles && (
                <CheckpointMarker
                    checkpointId={message.checkpointId}
                    taskDescription={message.taskDescription || 'Unknown task'}
                    files={message.checkpointFiles}
                    timestamp={message.timestamp}
                    onRestore={handleRestore}
                />
            )}
        </div>
    );
};
```

#### Step 4.4: Add Checkpoint Sidebar

**File**: CheckpointList.tsx (optional - shows all checkpoints)

```tsx
import React, { useEffect, useState } from 'react';

export const CheckpointList: React.FC = () => {
    const [checkpoints, setCheckpoints] = useState<CheckpointMetadata[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        loadCheckpoints();
    }, []);

    const loadCheckpoints = async () => {
        try {
            const result = await messenger.sendRequest(listCheckpoints, {});
            setCheckpoints(result.checkpoints);
        } catch (error) {
            console.error('Failed to load checkpoints:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleRestore = async (checkpointId: string) => {
        const confirmed = await showConfirmDialog(
            'Restore Checkpoint?',
            'This will revert your files to a previous state.'
        );

        if (!confirmed) return;

        try {
            const result = await messenger.sendRequest(restoreCheckpoint, {
                checkpointId
            });

            if (result.success) {
                showSuccess(`Restored ${result.filesRestored.length} file(s)`);
                loadCheckpoints(); // Refresh list
            } else {
                showError(`Restore failed: ${result.error}`);
            }
        } catch (error) {
            showError('Failed to restore checkpoint');
        }
    };

    if (loading) {
        return <div className="loading">Loading checkpoints...</div>;
    }

    if (checkpoints.length === 0) {
        return (
            <div className="empty-state">
                <p>No checkpoints yet</p>
                <p className="hint">Checkpoints are created when AI modifies files</p>
            </div>
        );
    }

    return (
        <div className="checkpoint-list">
            <h3>Checkpoints ({checkpoints.length})</h3>
            <div className="checkpoint-items">
                {checkpoints.map(checkpoint => (
                    <div key={checkpoint.id} className="checkpoint-item">
                        <div className="checkpoint-item-header">
                            <span className="checkpoint-item-icon">📑</span>
                            <span className="checkpoint-item-title">
                                {checkpoint.taskDescription}
                            </span>
                        </div>
                        <div className="checkpoint-item-meta">
                            <span>{new Date(checkpoint.timestamp).toLocaleString()}</span>
                            <span>•</span>
                            <span>{checkpoint.fileCount} file(s)</span>
                        </div>
                        <button
                            className="checkpoint-item-restore"
                            onClick={() => handleRestore(checkpoint.id)}
                        >
                            ↶ Restore
                        </button>
                    </div>
                ))}
            </div>
        </div>
    );
};
```

#### Step 4.5: Add CSS Styling

**File**: checkpoint-styles.css

```css
/* Checkpoint Marker Styles */
.checkpoint-marker {
    margin: 12px 0;
    padding: 12px;
    background: var(--vscode-editor-inactiveSelectionBackground);
    border-left: 3px solid var(--vscode-charts-blue);
    border-radius: 4px;
    font-size: 13px;
}

.checkpoint-header {
    display: flex;
    align-items: center;
    gap: 8px;
}

.checkpoint-icon {
    font-size: 16px;
}

.checkpoint-label {
    font-weight: 600;
    color: var(--vscode-charts-blue);
    flex: 1;
}

.checkpoint-restore-btn {
    padding: 4px 12px;
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.2s;
}

.checkpoint-restore-btn:hover {
    background: var(--vscode-button-hoverBackground);
}

.checkpoint-details-btn {
    padding: 4px 8px;
    background: transparent;
    color: var(--vscode-foreground);
    border: 1px solid var(--vscode-input-border);
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
}

.checkpoint-details {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid var(--vscode-panel-border);
}

.checkpoint-info {
    margin: 6px 0;
    color: var(--vscode-descriptionForeground);
}

.checkpoint-info strong {
    color: var(--vscode-foreground);
    margin-right: 6px;
}

.checkpoint-files {
    margin: 6px 0 0 20px;
    padding: 0;
    list-style: disc;
}

.checkpoint-files li {
    margin: 4px 0;
    font-family: var(--vscode-editor-font-family);
    font-size: 12px;
}

/* Checkpoint List Styles */
.checkpoint-list {
    padding: 16px;
}

.checkpoint-list h3 {
    margin: 0 0 12px 0;
    font-size: 14px;
    font-weight: 600;
}

.checkpoint-items {
    display: flex;
    flex-direction: column;
    gap: 8px;
}

.checkpoint-item {
    padding: 12px;
    background: var(--vscode-sideBar-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 6px;
    transition: background 0.2s;
}

.checkpoint-item:hover {
    background: var(--vscode-list-hoverBackground);
}

.checkpoint-item-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
}

.checkpoint-item-icon {
    font-size: 16px;
}

.checkpoint-item-title {
    flex: 1;
    font-weight: 500;
    font-size: 13px;
}

.checkpoint-item-meta {
    display: flex;
    gap: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    margin-bottom: 8px;
}

.checkpoint-item-restore {
    width: 100%;
    padding: 6px;
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
    border: none;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: background 0.2s;
}

.checkpoint-item-restore:hover {
    background: var(--vscode-button-secondaryHoverBackground);
}

/* Empty state */
.empty-state {
    text-align: center;
    padding: 40px 20px;
    color: var(--vscode-descriptionForeground);
}

.empty-state p {
    margin: 8px 0;
}

.empty-state .hint {
    font-size: 12px;
    font-style: italic;
}

/* Loading state */
.loading {
    text-align: center;
    padding: 20px;
    color: var(--vscode-descriptionForeground);
}
```

---

## Testing Strategy

### Manual Testing Checklist

#### Test 1: Checkpoint Creation
- [ ] Start AI chat and request code generation
- [ ] Complete a task that modifies files
- [ ] Verify checkpoint marker appears in webview
- [ ] Check Console for "[CheckpointManager] ✓ Checkpoint created"
- [ ] Verify files are listed in checkpoint details

#### Test 2: Local History Verification
- [ ] Open a modified file
- [ ] Open Timeline view (View → Open View → Timeline)
- [ ] Verify Local History entry exists near checkpoint time
- [ ] Right-click entry and select "Compare with File"
- [ ] Verify diff shows AI-generated changes

#### Test 3: Checkpoint Restoration (Timeline)
- [ ] Click "Restore" button on checkpoint marker
- [ ] Confirm restoration in dialog
- [ ] Verify Timeline view opens
- [ ] Select appropriate history entry
- [ ] Click "Restore Contents"
- [ ] Verify file reverts to previous state

#### Test 4: Checkpoint Restoration (Picker)
- [ ] Use `ballerina.ai.listCheckpoints` command
- [ ] Select checkpoint from quick pick
- [ ] Verify picker dialog opens
- [ ] Select history entry
- [ ] Verify restoration succeeds

#### Test 5: Multiple Files
- [ ] Request code that modifies 3+ files
- [ ] Verify checkpoint tracks all files
- [ ] Restore checkpoint
- [ ] Verify all files revert correctly

#### Test 6: Sequential Checkpoints
- [ ] Complete task 1 → checkpoint 1
- [ ] Complete task 2 → checkpoint 2
- [ ] Complete task 3 → checkpoint 3
- [ ] Restore checkpoint 1
- [ ] Verify workspace matches checkpoint 1 state

#### Test 7: Error Handling
- [ ] Disable Local History in settings
- [ ] Create checkpoint (should warn but continue)
- [ ] Try to restore (should show appropriate error)

### Automated Testing

**File**: `checkpoint.test.ts`

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';
import { CheckpointManager } from '../checkpoint/CheckpointManager';

suite('CheckpointManager Tests', () => {
    let manager: CheckpointManager;

    suiteSetup(() => {
        // Initialize manager with test context
        const context = vscode.extensions.getExtension('wso2.ballerina')!.extensionContext;
        CheckpointManager.initialize(context);
        manager = CheckpointManager.getInstance();
    });

    test('Creates checkpoint successfully', async () => {
        const sourceFiles = [
            {
                filePath: 'test.bal',
                content: 'public function main() {}',
                languageId: 'ballerina'
            }
        ];

        const checkpointId = await manager.createCheckpoint(
            sourceFiles,
            'Test checkpoint',
            'msg-test-123'
        );

        assert.ok(checkpointId);
        assert.ok(checkpointId.startsWith('checkpoint-'));
    });

    test('Lists checkpoints correctly', async () => {
        const checkpoints = await manager.listCheckpoints();
        assert.ok(Array.isArray(checkpoints));
        assert.ok(checkpoints.length > 0);
    });

    test('Filters checkpoints by message ID', async () => {
        const checkpoints = await manager.listCheckpoints('msg-test-123');
        assert.ok(checkpoints.every(c => c.messageId === 'msg-test-123'));
    });

    test('Gets checkpoint stats', async () => {
        const stats = await manager.getStats();
        assert.ok(stats.totalCheckpoints >= 0);
        assert.ok(stats.totalFiles >= 0);
    });
});
```

---

## Troubleshooting

### Problem: Checkpoint not appearing in Timeline

**Symptoms**:
- Checkpoint created successfully
- But no entry in Timeline view

**Diagnosis**:
1. Check if Local History is enabled:
   ```typescript
   const config = vscode.workspace.getConfiguration('workbench');
   console.log('Local History enabled:', config.get('localHistory.enabled'));
   ```

2. Check file size limit:
   ```typescript
   const maxSize = config.get<number>('localHistory.maxFileSize');
   console.log('Max file size:', maxSize, 'bytes');
   // Default is 256 KB
   ```

3. Check if file was actually saved:
   - Local History only tracks saved files
   - Verify `workspace.applyEdit()` was called
   - Verify `workspace.saveAll()` was called after edits

**Solutions**:
- Enable Local History: Set `workbench.localHistory.enabled` to `true`
- Increase file size limit if needed
- Ensure files are saved after applying edits

---

### Problem: Cannot restore checkpoint programmatically

**Symptoms**:
- Checkpoint exists
- But Timeline shows no entries or wrong entries

**Explanation**:
VS Code's Local History doesn't provide a programmatic restoration API. Extensions can only:
- ✅ Show Timeline view
- ✅ Show restore picker
- ❌ Programmatically select and restore specific entries

**Workarounds**:
1. Use `workbench.action.localHistory.restoreViaPicker` (shows dialog)
2. Use Timeline view and guide users
3. Store full file contents yourself (defeats purpose of Local History)

**Best Approach**:
Show Timeline view + provide clear instructions to user

---

### Problem: Too many checkpoints filling storage

**Symptoms**:
- Extension storage growing large
- Performance degradation

**Solutions**:
1. Limit stored checkpoints:
   ```typescript
   // In storage.ts, keep only last 50
   const trimmed = checkpoints.slice(0, 50);
   ```

2. Add cleanup command:
   ```typescript
   vscode.commands.registerCommand('ballerina.ai.cleanupCheckpoints', async () => {
       const manager = CheckpointManager.getInstance();
       await manager.deleteAllCheckpoints();
       vscode.window.showInformationMessage('Checkpoints cleared');
   });
   ```

3. Let VS Code handle Local History retention automatically

---

### Problem: Checkpoint restored but changes not visible

**Symptoms**:
- Restoration succeeds
- But editor shows old content

**Solutions**:
1. Reload document after restoration:
   ```typescript
   // After restore
   await vscode.commands.executeCommand('workbench.action.files.revert');
   ```

2. Close and reopen file:
   ```typescript
   await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
   await vscode.window.showTextDocument(uri);
   ```

---

## Summary

### What You're Building

A lightweight checkpoint system that:
- ✅ Creates named Local History entries before AI modifications
- ✅ Stores minimal metadata (which task = which files)
- ✅ Shows checkpoint UI in your custom webview
- ✅ Enables restoration via Timeline view or picker

### Key Advantages

| Benefit | Impact |
|---------|--------|
| **No File Storage** | Zero storage overhead, VS Code handles everything |
| **Automatic Cleanup** | No need to manage retention or deletion |
| **User Trust** | Leverages built-in VS Code feature users already trust |
| **Fast Implementation** | 6-10 hours vs 20+ hours for custom solution |
| **Low Maintenance** | VS Code maintains the storage system |

### Implementation Timeline

- **Phase 1**: Checkpoint infrastructure (3-4 hours)
- **Phase 2**: Task integration (1-2 hours)
- **Phase 3**: RPC communication (1 hour)
- **Phase 4**: Webview UI (2-3 hours)
- **Testing**: 1 hour

**Total**: 6-10 hours

### Next Steps

1. Create checkpoint infrastructure files
2. Test checkpoint creation with simple example
3. Integrate with task completion flow
4. Add webview UI components
5. Test end-to-end workflow
6. Polish and document

---

**Document Version**: 1.0
**Last Updated**: 2025-11-05
**Author**: Claude (Anthropic)
**Status**: Ready for Implementation
