# Checkpoint Implementation Approach Analysis

## Executive Summary

This document analyzes three potential approaches for implementing checkpoint/restore functionality in the Ballerina VS Code extension and explains why the **custom UndoRedoManager approach** is the only viable solution.

---

## Approach 1: VS Code Native Chat Checkpoints (❌ NOT VIABLE)

### What It Is
VS Code 1.103+ introduced automatic checkpoint functionality for **chat participant extensions** that use the `ChatResponseStream` API.

### How It Would Work (In Theory)
```typescript
// In a chat participant handler
async function handleChatRequest(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,  // Provided by VS Code
    token: vscode.CancellationToken
) {
    // Wrap file changes
    await stream.externalEdit([uri1, uri2], async () => {
        stream.textEdit(uri1, [edit]);
        stream.textEdit(uri1, true);
    });
    // → Bookmark icon appears automatically
    // → "Restore workspace" button appears automatically
}
```

### Why It Doesn't Work for Ballerina Extension

#### 1. No Chat Participant Registration
**Evidence**: Searched entire codebase for:
```
createChatParticipant
registerChatParticipant
chat.createChatParticipant
```
**Result**: **Zero matches** - the extension does NOT use VS Code's chat participant API.

#### 2. Custom Webview-Based Architecture
The Ballerina extension uses:
- **Custom webview panel** for AI chat UI (`AIPanel`)
- **RPC communication** via `vscode-messenger` between extension and webview
- **React-based frontend** in `ballerina-visualizer/src/views/AIPanel`

**No ChatResponseStream exists** in this architecture because it's only provided to chat participant handlers.

#### 3. File Structure Evidence
```
src/rpc-managers/ai-panel/
├── rpc-manager.ts          # RPC methods
├── rpc-handler.ts          # RPC registration
└── utils.ts                # addToIntegration() - direct file writes

ballerina-visualizer/src/views/AIPanel/
├── components/
│   ├── AIChat/
│   └── CodeSection.tsx     # Custom UI with buttons
```

**Conclusion**: The extension is NOT a chat participant - it's a standalone webview panel with RPC communication.

---

## Approach 2: VS Code Local History API (❌ NOT VIABLE)

### What It Is
VS Code 1.66+ includes built-in local history that automatically saves file versions every time you save.

**Storage Location**: `AppData/Roaming/Code/User/History/{id}`

### How It Would Work (In Theory)
```typescript
// Programmatically restore to a specific local history point
await vscode.commands.executeCommand('timeline.restore', uri, timestamp);
```

### Why It Doesn't Work

#### 1. No Programmatic Restore API
**Available APIs**:
- ✅ `workspace.registerTimelineProvider()` - For **contributing** timeline sources (e.g., Git history)
- ✅ `TimelineProvider.provideTimeline()` - For **showing** timeline items
- ❌ **No API to restore from a timeline point**

**From VS Code API Documentation**:
> The Timeline API allows extensions to contribute additional timeline sources that are shown in the Timeline view. Extensions can register a TimelineProvider for a set of documents.

**Key Finding**: The API is for **providing** timeline data, NOT for **consuming/restoring** from it.

#### 2. Timeline View is UI-Only
Users can manually restore by:
1. Opening Timeline view in Explorer
2. Right-clicking a history entry
3. Selecting "Restore Contents"

**But**: No programmatic API to trigger this from an extension.

#### 3. No Way to Associate History with Message IDs
Even if we could restore programmatically:
- Local history entries are **per-file, per-save**
- No way to tag them with custom metadata (like message IDs)
- No way to restore **multiple files atomically** to a specific conversation turn

#### 4. Research Evidence
**GitHub Issue**: [API support for Timeline view #84297](https://github.com/microsoft/vscode/issues/84297)
- Timeline API is **read-only** for consumption
- Extensions can **provide** timeline sources
- Extensions **cannot** programmatically restore

**Stack Overflow**: Multiple questions asking how to access local history programmatically - **no solutions exist**.

**Conclusion**: VS Code local history is a **user-facing feature only** - no programmatic restore API exists.

---

## Approach 3: Custom UndoRedoManager (✅ VIABLE)

### What It Is
Use the **existing UndoRedoManager** already in the Ballerina extension codebase to track file snapshots and enable programmatic restoration.

**Location**: `src/utils/undo-redo-manager.ts`

### Why It Works

#### 1. Already Exists and Is Tested
```typescript
class UndoRedoManager {
    // Store file content snapshots
    startBatchOperation(): void
    addFileToBatch(path, beforeContent, afterContent): void
    commitBatchOperation(description?: string): void

    // Restore to previous state
    undo(count?: number): FileChange[]
    redo(count?: number): FileChange[]

    // Query state
    getUndoCount(): number
    getUndoInfo(): OperationInfo[]
}
```

**Key Features**:
- ✅ Stores full file content (before/after)
- ✅ Supports batch operations (multiple files in one checkpoint)
- ✅ Stack-based (up to 20 operations)
- ✅ Returns file changes for application
- ✅ Already integrated with workspace edits

#### 2. Perfect for Our Use Case
```typescript
// Create checkpoint during integration
undoRedoManager.startBatchOperation();
for (const fileChange of fileChanges) {
    undoRedoManager.addFileToBatch(
        filePath,
        beforeContent,  // Read from disk
        afterContent    // New content from AI
    );
}
undoRedoManager.commitBatchOperation(`AI Integration: ${messageId}`);

// Restore to checkpoint
const checkpointIndex = findCheckpointByMessageId(messageId);
const stepsToUndo = currentIndex - checkpointIndex;
for (let i = 0; i < stepsToUndo; i++) {
    const changes = undoRedoManager.undo();
    await applyChanges(changes);  // Use workspace.applyEdit()
}
```

#### 3. Custom UI Integration
Since the extension has a custom webview UI:
- ✅ Full control over restore button placement
- ✅ Can associate checkpoints with message IDs
- ✅ Can show checkpoint metadata
- ✅ Works with existing RPC architecture

```typescript
// RPC Methods
rpc.registerHandler('getCheckpoints', () => {
    return undoRedoManager.getUndoInfo();
});

rpc.registerHandler('restoreToCheckpoint', (messageId) => {
    return restoreToCheckpoint(messageId);
});
```

#### 4. Integration Point Analysis
**Current Flow**:
```
User message → AI generates code
  → handleTaskCompletion()
  → integrateCodeToWorkspace()
  → addToIntegration()  ← FILE WRITES HAPPEN HERE
  → workspace.applyEdit() + fs.writeFileSync()
```

**With Checkpoints**:
```
User message (ID: msg-123) → AI generates code
  → handleTaskCompletion()
  → integrateCodeToWorkspace(files, messageId)
  → addToIntegration(workspacePath, files, messageId)
  → undoRedoManager.startBatchOperation()  ← NEW
  → Read before-content for each file      ← NEW
  → undoRedoManager.addFileToBatch()       ← NEW
  → workspace.applyEdit() + fs.writeFileSync()
  → undoRedoManager.commitBatchOperation() ← NEW
  → Checkpoint created!
```

**Restore Flow**:
```
User clicks restore icon on msg-123
  → RPC: restoreToCheckpoint(msg-123)
  → Find checkpoint index
  → Call undoRedoManager.undo() N times
  → Apply returned file changes
  → UI updates
```

---

## Comparison Table

| Feature | Native Chat Checkpoints | Local History API | Custom UndoRedoManager |
|---------|------------------------|-------------------|------------------------|
| **Requires Chat Participant** | ✅ Yes | ❌ No | ❌ No |
| **Programmatic Restore** | ✅ Yes (if participant) | ❌ No API | ✅ Yes |
| **Message ID Association** | ✅ Automatic | ❌ Not possible | ✅ Custom metadata |
| **Multi-File Atomic Restore** | ✅ Yes | ❌ No | ✅ Yes (batch operations) |
| **Custom UI Integration** | ❌ VS Code UI only | ❌ Timeline view only | ✅ Full control |
| **Works with Webview UI** | ❌ No | N/A | ✅ Yes |
| **Storage** | VS Code manages | VS Code manages | In-memory (20 operations) |
| **Cross-Session Persistence** | ✅ Yes | ✅ Yes | ❌ No (can be added) |
| **Implementation Complexity** | Low (if participant) | N/A (not possible) | Medium |
| **Lines of Code** | ~50 | N/A | ~200 |
| **Works TODAY** | ❌ NO | ❌ NO | ✅ YES |

---

## Technical Constraints

### Why We Can't Use VS Code Native APIs

#### 1. Architectural Mismatch
**Ballerina Extension**:
```
User interacts with React webview
  ↓
RPC message to extension
  ↓
Extension calls AI service
  ↓
Direct file writes via workspace.applyEdit()
```

**VS Code Chat Participant**:
```
User types in VS Code's native chat UI
  ↓
VS Code calls participant handler WITH stream
  ↓
Participant uses stream.textEdit()
  ↓
VS Code tracks everything automatically
```

**Incompatible Architectures**: The Ballerina extension is NOT a chat participant.

#### 2. No Stream Parameter Available
**Chat Participant Handler Signature**:
```typescript
async function handler(
    request: vscode.ChatRequest,
    context: vscode.ChatContext,
    stream: vscode.ChatResponseStream,  // ← This is the key
    token: vscode.CancellationToken
): Promise<vscode.ChatResult>
```

**Ballerina's RPC Handler**:
```typescript
async generateDesign(params: GenerateAgentCodeRequest): Promise<boolean> {
    await generateDesign(params);  // ← No stream parameter!
    return true;
}
```

**Cannot Get Stream**: The extension doesn't receive a ChatResponseStream because it's not registered as a chat participant.

#### 3. File Write Pattern
**Ballerina Extension**:
- Uses `workspace.applyEdit()` directly
- Uses `fs.writeFileSync()` for non-.bal files
- No streaming interface

**Chat Participant Pattern**:
- Must use `stream.textEdit(uri, edits)`
- Must mark complete with `stream.textEdit(uri, true)`
- Changes tracked automatically

**Incompatible Patterns**: Would require complete rewrite to chat participant architecture.

---

## Migration Path Analysis

### Option A: Migrate to Chat Participant Architecture

**Effort**: 40-60 hours

**Changes Required**:
1. Remove custom webview UI
2. Register chat participant with VS Code
3. Migrate to VS Code's chat UI (lose custom branding/features)
4. Rewrite all RPC handlers to use chat context
5. Update frontend to use VS Code chat markdown
6. Test entire flow
7. Update documentation

**Benefits**:
- ✅ Native checkpoints
- ✅ Better VS Code integration
- ✅ Automatic UI updates

**Drawbacks**:
- ❌ Lose custom UI/UX
- ❌ Lose branding
- ❌ Lose custom features (e.g., task approval UI)
- ❌ Major breaking change
- ❌ Users must adapt to new interface

### Option B: Use Custom UndoRedoManager

**Effort**: 3-4 hours

**Changes Required**:
1. Modify `addToIntegration()` to use UndoRedoManager (~30 lines)
2. Pass messageId through call chain (~10 lines)
3. Add RPC handlers for restore (~50 lines)
4. Add UI restore button (~40 lines)
5. Test checkpoint creation/restoration

**Benefits**:
- ✅ Minimal code changes
- ✅ Keep existing UI/UX
- ✅ Keep all custom features
- ✅ Works immediately
- ✅ No breaking changes

**Drawbacks**:
- ❌ No cross-session persistence (can be added later)
- ❌ Limited to 20 checkpoints (can be increased)
- ❌ Manual storage management

---

## Recommendation

**Use Custom UndoRedoManager Approach (Option B)**

### Reasoning

1. **Architectural Reality**: The Ballerina extension is NOT a chat participant and has no plans to become one
2. **API Limitations**: No programmatic restore API exists for VS Code local history
3. **Practical Solution**: UndoRedoManager already exists, works, and is tested
4. **Minimal Risk**: Small, isolated code changes with no breaking changes
5. **Fast Implementation**: 3-4 hours vs 40-60 hours for migration
6. **Feature Preservation**: Keep all custom UI/UX and features

### Future Enhancements

If needed later, we can:
- ✅ Add persistence to globalState/workspaceState
- ✅ Increase checkpoint limit beyond 20
- ✅ Add checkpoint preview/diff view
- ✅ Export/import checkpoints
- ✅ Compress snapshots to save memory

---

## Implementation Summary

### Modified Files (5 files)
1. `src/rpc-managers/ai-panel/utils.ts` - Add UndoRedoManager to addToIntegration()
2. `src/features/ai/service/design/utils.ts` - Pass messageId through
3. `src/features/ai/service/libs/task_write_tool.ts` - Extract messageId
4. `src/rpc-managers/ai-panel/rpc-manager.ts` - Add restore RPC methods
5. `ballerina-visualizer/src/views/AIPanel/components/ChatMessage.tsx` - Add restore UI

### Total Lines of Code: ~200 lines

### Key Integration Points
```typescript
// 1. Checkpoint Creation (addToIntegration)
if (messageId) {
    undoRedoManager.startBatchOperation();
    // Track before/after content
    undoRedoManager.commitBatchOperation(`AI: ${messageId}`);
}

// 2. Checkpoint Restoration (RPC handler)
async restoreToCheckpoint(messageId: string): Promise<boolean> {
    const index = findCheckpointIndex(messageId);
    const changes = undoRedoManager.undoToIndex(index);
    await applyChanges(changes);
    return true;
}

// 3. UI Integration (React component)
{hasCheckpoint && (
    <button onClick={() => rpc.call('restoreToCheckpoint', messageId)}>
        <HistoryIcon /> Restore
    </button>
)}
```

---

## Conclusion

While VS Code provides powerful native features for chat participants and local history:
- **Chat checkpoints** require being a chat participant (we're not)
- **Local history** has no programmatic restore API (read-only)

The **custom UndoRedoManager approach** is:
- ✅ The ONLY viable solution
- ✅ Uses existing, tested infrastructure
- ✅ Minimal code changes
- ✅ Works with current architecture
- ✅ Fast to implement

**Decision**: Proceed with custom UndoRedoManager implementation.

---

**Document Version**: 1.0
**Date**: 2025-11-05
**Author**: Claude (Anthropic)
**Status**: Analysis Complete - Ready for Implementation
