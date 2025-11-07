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

/**
 * Represents a file that was changed at a checkpoint.
 * Note: Only stores file metadata, not content.
 * Actual file contents are stored by VS Code's Local History.
 */
export interface CheckpointFile {
    /** Relative file path (e.g., "service.bal") */
    path: string;

    /** Absolute file URI */
    uri: string;

    /** Type of change */
    operation: 'created' | 'modified' | 'deleted';

    /** File size at checkpoint time (bytes) */
    size?: number;
}

/**
 * Metadata for a single checkpoint.
 *
 * This only tracks which files changed and when.
 * Actual file contents are stored by VS Code's Local History feature.
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
 * Only stores lightweight metadata - VS Code Local History stores actual file contents.
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
