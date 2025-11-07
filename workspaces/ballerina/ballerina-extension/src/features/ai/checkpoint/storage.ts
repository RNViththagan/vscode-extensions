// Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import * as vscode from 'vscode';
import { CheckpointMetadata, CheckpointStorage } from './types';

/**
 * Stores checkpoint metadata using VS Code's WorkspaceState (memento).
 *
 * IMPORTANT: This only stores metadata (~500 bytes per checkpoint).
 * Actual file contents are stored by VS Code's Local History feature.
 *
 * Storage location: VS Code's workspace-specific storage
 * Retention: Last 50 checkpoints per workspace
 */
export class WorkspaceCheckpointStorage implements CheckpointStorage {
    private static readonly STORAGE_KEY = 'ballerina.ai.checkpoints';
    private static readonly MAX_CHECKPOINTS = 50;
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

        // Keep only last N checkpoints to prevent unbounded growth
        const trimmed = checkpoints.slice(0, WorkspaceCheckpointStorage.MAX_CHECKPOINTS);

        await this.memento.update(WorkspaceCheckpointStorage.STORAGE_KEY, trimmed);

        console.log(`[Checkpoint Storage] Saved checkpoint: ${checkpoint.id} (${checkpoints.length} total, kept ${trimmed.length})`);
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

        console.log(`[Checkpoint Storage] Loaded ${stored.length} checkpoint metadata entries`);
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
     * Returns JSON string of all checkpoint metadata.
     */
    async exportToJSON(): Promise<string> {
        const checkpoints = await this.loadAll();
        return JSON.stringify(checkpoints, null, 2);
    }

    /**
     * Get storage statistics.
     */
    async getStats(): Promise<{
        count: number;
        estimatedSize: number;
    }> {
        const checkpoints = await this.loadAll();
        const estimatedSize = JSON.stringify(checkpoints).length;

        return {
            count: checkpoints.length,
            estimatedSize
        };
    }
}
