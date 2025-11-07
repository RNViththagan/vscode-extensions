// Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com/) All Rights Reserved.

// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at

// http://www.apache.org/licenses/LICENSE-2.0

// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied. See the License for the
// specific language governing permissions and limitations
// under the License.

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { CheckpointMetadata, CheckpointFile, CheckpointStorage, RestoreResult } from './types';
import { WorkspaceCheckpointStorage } from './storage';
import { FileChanges } from '@wso2/ballerina-core';

/**
 * Manages AI-generated code checkpoints using VS Code's Local History feature.
 *
 * Architecture:
 * - File contents: Stored automatically by VS Code Local History (no cost to us)
 * - Metadata: Stored in WorkspaceState memento (~500 bytes per checkpoint)
 *
 * Requirements:
 * - VS Code 1.66+ (Local History feature)
 * - workbench.localHistory.enabled setting must be true
 *
 * Usage:
 * 1. Initialize in extension activation: CheckpointManager.initialize(context)
 * 2. Create checkpoints: await manager.createCheckpoint(messageId, workspacePath, fileChanges)
 * 3. Restore checkpoints: await manager.restoreCheckpoint(checkpointId)
 */
export class CheckpointManager {
    private static instance: CheckpointManager | null = null;
    private storage: CheckpointStorage;
    private context: vscode.ExtensionContext;

    private constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.storage = new WorkspaceCheckpointStorage(context);
        console.log('[CheckpointManager] Initialized with VS Code Local History');
    }

    /**
     * Initialize the CheckpointManager singleton.
     * MUST be called during extension activation before any other methods.
     */
    public static initialize(context: vscode.ExtensionContext): void {
        if (!CheckpointManager.instance) {
            CheckpointManager.instance = new CheckpointManager(context);
            console.log('[CheckpointManager] Singleton initialized');
        }
    }

    /**
     * Get the CheckpointManager singleton instance.
     * Throws if not initialized.
     */
    public static getInstance(): CheckpointManager {
        if (!CheckpointManager.instance) {
            throw new Error('CheckpointManager not initialized. Call CheckpointManager.initialize(context) first.');
        }
        return CheckpointManager.instance;
    }

    /**
     * Creates a checkpoint for AI-generated file changes.
     *
     * How it works:
     * 1. Creates named Local History entries for all modified files
     * 2. Stores lightweight metadata in WorkspaceState
     * 3. Returns checkpoint ID for future restoration
     *
     * Note: VS Code Local History automatically captures file state on save.
     * This method creates NAMED entries for easier identification.
     *
     * @param messageId - Chat message ID associated with this checkpoint
     * @param workspaceFolderPath - Absolute path to workspace folder
     * @param fileChanges - Array of file changes to checkpoint
     * @param taskDescription - Optional description (e.g., "Create MySQL connection")
     * @returns Promise resolving to checkpoint ID
     */
    public async createCheckpoint(
        messageId: string,
        workspaceFolderPath: string,
        fileChanges: FileChanges[],
        taskDescription?: string
    ): Promise<string> {
        console.log(`[CheckpointManager] Creating checkpoint for message: ${messageId}`);

        // Verify Local History is enabled
        const config = vscode.workspace.getConfiguration('workbench');
        const localHistoryEnabled = config.get<boolean>('localHistory.enabled', true);

        if (!localHistoryEnabled) {
            console.warn('[CheckpointManager] VS Code Local History is disabled. Enable it in settings.');
            vscode.window.showWarningMessage(
                'Local History is disabled. Checkpoints will be created but file history may not be available.',
                'Enable Local History'
            ).then(selection => {
                if (selection === 'Enable Local History') {
                    config.update('localHistory.enabled', true, vscode.ConfigurationTarget.Global);
                }
            });
        }

        // Generate checkpoint ID and metadata
        const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
        const timestamp = Date.now();
        const description = taskDescription || `AI Integration: ${messageId}`;
        const label = `AI: ${description}`;

        // Build checkpoint file metadata
        const checkpointFiles: CheckpointFile[] = [];

        for (const fileChange of fileChanges) {
            const fullPath = path.join(workspaceFolderPath, fileChange.filePath);
            const uri = vscode.Uri.file(fullPath);

            // Determine operation type
            const fileExists = fs.existsSync(fullPath);
            let operation: 'created' | 'modified' | 'deleted';
            let size: number | undefined;

            if (!fileExists) {
                operation = 'created';
            } else {
                operation = 'modified';
                try {
                    const stats = fs.statSync(fullPath);
                    size = stats.size;
                } catch (error) {
                    console.warn(`[CheckpointManager] Failed to stat file: ${fullPath}`, error);
                }
            }

            // Create named Local History entry for existing files
            // New files will get history automatically on first save
            if (operation === 'modified') {
                try {
                    await vscode.commands.executeCommand('workbench.action.localHistory.create', uri);
                    console.log(`[CheckpointManager] Created Local History entry for: ${fileChange.filePath}`);
                } catch (error) {
                    console.error(`[CheckpointManager] Failed to create Local History entry for ${fileChange.filePath}:`, error);
                    // Continue anyway - Local History might still capture on save
                }
            }

            checkpointFiles.push({
                path: fileChange.filePath,
                uri: uri.toString(),
                operation,
                size
            });
        }

        // Save checkpoint metadata
        const metadata: CheckpointMetadata = {
            id: checkpointId,
            messageId,
            taskDescription: description,
            timestamp,
            files: checkpointFiles,
            label,
            restorable: true
        };

        await this.storage.save(metadata);

        console.log(`[CheckpointManager] Checkpoint created: ${checkpointId} (${checkpointFiles.length} files)`);
        return checkpointId;
    }

    /**
     * Restores workspace to a specific checkpoint.
     *
     * Opens VS Code's Timeline view filtered to the checkpoint timestamp,
     * allowing users to visually compare and restore files.
     *
     * Alternative: Use restoreViaPicker() for a picker-based UI.
     *
     * @param checkpointId - Checkpoint ID to restore
     * @returns Promise resolving to restore result
     */
    public async restoreCheckpoint(checkpointId: string): Promise<RestoreResult> {
        console.log(`[CheckpointManager] Restoring checkpoint: ${checkpointId}`);

        // Load checkpoint metadata
        const metadata = await this.storage.load(checkpointId);
        if (!metadata) {
            const error = `Checkpoint not found: ${checkpointId}`;
            console.error(`[CheckpointManager] ${error}`);
            return {
                success: false,
                checkpointId,
                filesRestored: [],
                errors: [{ file: 'checkpoint', error }]
            };
        }

        if (!metadata.restorable) {
            const error = 'Checkpoint is marked as non-restorable';
            console.error(`[CheckpointManager] ${error}`);
            return {
                success: false,
                checkpointId,
                filesRestored: [],
                errors: [{ file: 'checkpoint', error }]
            };
        }

        // Open Timeline view for each file
        const filesRestored: string[] = [];
        const errors: Array<{ file: string; error: string }> = [];

        for (const file of metadata.files) {
            try {
                const uri = vscode.Uri.parse(file.uri);

                // Open the file
                const document = await vscode.workspace.openTextDocument(uri);
                await vscode.window.showTextDocument(document);

                // Open Timeline view
                await vscode.commands.executeCommand('timeline.focus');

                filesRestored.push(file.path);
                console.log(`[CheckpointManager] Opened Timeline for: ${file.path}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                errors.push({ file: file.path, error: errorMessage });
                console.error(`[CheckpointManager] Failed to restore ${file.path}:`, errorMessage);
            }
        }

        const success = errors.length === 0;

        if (success) {
            vscode.window.showInformationMessage(
                `Checkpoint restored. Review the Timeline view to restore individual files.`
            );
        } else {
            vscode.window.showWarningMessage(
                `Checkpoint partially restored. ${errors.length} file(s) had errors.`
            );
        }

        return {
            success,
            checkpointId,
            filesRestored,
            errors: errors.length > 0 ? errors : undefined
        };
    }

    /**
     * Shows VS Code's restore picker for a checkpoint.
     *
     * This provides a more interactive restoration experience where users
     * can select which files to restore and preview changes.
     *
     * @param checkpointId - Checkpoint ID to restore
     * @returns Promise resolving to restore result
     */
    public async restoreViaPicker(checkpointId: string): Promise<RestoreResult> {
        console.log(`[CheckpointManager] Opening restore picker for checkpoint: ${checkpointId}`);

        // Load checkpoint metadata
        const metadata = await this.storage.load(checkpointId);
        if (!metadata) {
            const error = `Checkpoint not found: ${checkpointId}`;
            console.error(`[CheckpointManager] ${error}`);
            return {
                success: false,
                checkpointId,
                filesRestored: [],
                errors: [{ file: 'checkpoint', error }]
            };
        }

        // Show quick pick for file selection
        const fileItems = metadata.files.map(file => ({
            label: file.path,
            description: file.operation,
            detail: file.size ? `${(file.size / 1024).toFixed(1)} KB` : 'New file',
            file
        }));

        const selected = await vscode.window.showQuickPick(fileItems, {
            canPickMany: true,
            placeHolder: 'Select files to restore',
            title: `Restore Checkpoint: ${metadata.taskDescription}`
        });

        if (!selected || selected.length === 0) {
            console.log('[CheckpointManager] Restore cancelled by user');
            return {
                success: false,
                checkpointId,
                filesRestored: [],
                errors: [{ file: 'user', error: 'Restore cancelled' }]
            };
        }

        // Open restore picker for each selected file
        const filesRestored: string[] = [];
        const errors: Array<{ file: string; error: string }> = [];

        for (const item of selected) {
            try {
                const uri = vscode.Uri.parse(item.file.uri);

                // Use VS Code's restore picker command
                await vscode.commands.executeCommand(
                    'workbench.action.localHistory.restoreViaPicker',
                    uri
                );

                filesRestored.push(item.file.path);
                console.log(`[CheckpointManager] Restored: ${item.file.path}`);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : 'Unknown error';
                errors.push({ file: item.file.path, error: errorMessage });
                console.error(`[CheckpointManager] Failed to restore ${item.file.path}:`, errorMessage);
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
     * Gets checkpoint metadata by ID.
     */
    public async getCheckpoint(checkpointId: string): Promise<CheckpointMetadata | undefined> {
        return this.storage.load(checkpointId);
    }

    /**
     * Gets checkpoint metadata by message ID.
     */
    public async getCheckpointByMessageId(messageId: string): Promise<CheckpointMetadata | undefined> {
        const all = await this.storage.loadAll();
        return all.find(c => c.messageId === messageId);
    }

    /**
     * Gets all checkpoint metadata.
     */
    public async getAllCheckpoints(): Promise<CheckpointMetadata[]> {
        return this.storage.loadAll();
    }

    /**
     * Deletes checkpoint metadata.
     * Note: Does not delete VS Code Local History entries.
     */
    public async deleteCheckpoint(checkpointId: string): Promise<void> {
        await this.storage.delete(checkpointId);
        console.log(`[CheckpointManager] Deleted checkpoint: ${checkpointId}`);
    }

    /**
     * Deletes all checkpoint metadata.
     * Note: Does not delete VS Code Local History entries.
     */
    public async deleteAllCheckpoints(): Promise<void> {
        await this.storage.deleteAll();
        console.log('[CheckpointManager] Deleted all checkpoints');
    }

    /**
     * Checks if a checkpoint exists for a message ID.
     */
    public async hasCheckpoint(messageId: string): Promise<boolean> {
        const checkpoint = await this.getCheckpointByMessageId(messageId);
        return checkpoint !== undefined;
    }

    /**
     * Gets storage statistics.
     */
    public async getStats(): Promise<{
        count: number;
        estimatedSize: number;
    }> {
        const checkpoints = await this.storage.loadAll();
        const estimatedSize = JSON.stringify(checkpoints).length;

        return {
            count: checkpoints.length,
            estimatedSize
        };
    }

    /**
     * Exports all checkpoint metadata as JSON.
     * Useful for debugging or backup.
     */
    public async exportToJSON(): Promise<string> {
        const checkpoints = await this.storage.loadAll();
        return JSON.stringify(checkpoints, null, 2);
    }

    /**
     * Checks if VS Code Local History is enabled and configured properly.
     */
    public async verifyLocalHistoryEnabled(): Promise<{
        enabled: boolean;
        maxFileEntries: number;
        maxFileSize: number;
    }> {
        const config = vscode.workspace.getConfiguration('workbench');

        return {
            enabled: config.get<boolean>('localHistory.enabled', true),
            maxFileEntries: config.get<number>('localHistory.maxFileEntries', 50),
            maxFileSize: config.get<number>('localHistory.maxFileSize', 256)
        };
    }
}
