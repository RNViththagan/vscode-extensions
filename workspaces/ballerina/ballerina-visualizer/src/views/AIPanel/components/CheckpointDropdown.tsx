/**
 * Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com) All Rights Reserved.
 *
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

import React, { useEffect, useState } from "react";
import { useRpcContext } from "@wso2/ballerina-rpc-client";
import styled from "@emotion/styled";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";

const CheckpointContainer = styled.div`
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--vscode-editor-background);
    border: 1px solid var(--vscode-panel-border);
    border-radius: 4px;
`;

const StyledDropdown = styled(VSCodeDropdown)`
    min-width: 300px;
`;

const StyledLabel = styled.span`
    color: var(--vscode-foreground);
    font-size: 12px;
    white-space: nowrap;
`;

interface Checkpoint {
    messageId: string;
    undoIndex: number;
    description: string;
    timestamp: number;
}

const CheckpointDropdown: React.FC = () => {
    const { rpcClient } = useRpcContext();
    const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
    const [selectedCheckpoint, setSelectedCheckpoint] = useState<string>("");
    const [isRestoring, setIsRestoring] = useState(false);

    useEffect(() => {
        loadCheckpoints();
    }, []);

    const loadCheckpoints = async () => {
        try {
            const allCheckpoints = await rpcClient.getAiPanelRpcClient().getAllCheckpoints();
            setCheckpoints(allCheckpoints);
        } catch (error) {
            console.error("[CheckpointDropdown] Failed to load checkpoints:", error);
        }
    };

    const handleRestore = async () => {
        if (!selectedCheckpoint) {
            return;
        }

        setIsRestoring(true);
        try {
            const success = await rpcClient.getAiPanelRpcClient().restoreToCheckpoint(selectedCheckpoint);
            if (success) {
                console.log("[CheckpointDropdown] Checkpoint restored successfully");
            } else {
                console.error("[CheckpointDropdown] Failed to restore checkpoint");
            }
        } catch (error) {
            console.error("[CheckpointDropdown] Error restoring checkpoint:", error);
        } finally {
            setIsRestoring(false);
        }
    };

    const handleChange = (e: any) => {
        setSelectedCheckpoint(e.target.value);
    };

    const formatTimestamp = (timestamp: number) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    if (checkpoints.length === 0) {
        return null;
    }

    return (
        <CheckpointContainer>
            <StyledLabel>Checkpoints:</StyledLabel>
            <StyledDropdown value={selectedCheckpoint} onChange={handleChange}>
                <VSCodeOption value="">Select a checkpoint...</VSCodeOption>
                {checkpoints.map((checkpoint) => (
                    <VSCodeOption key={checkpoint.messageId} value={checkpoint.messageId}>
                        {checkpoint.description} - {formatTimestamp(checkpoint.timestamp)}
                    </VSCodeOption>
                ))}
            </StyledDropdown>
            <VSCodeButton
                appearance="secondary"
                onClick={handleRestore}
                disabled={!selectedCheckpoint || isRestoring}
            >
                {isRestoring ? "Restoring..." : "Restore"}
            </VSCodeButton>
            <VSCodeButton appearance="icon" onClick={loadCheckpoints} title="Refresh checkpoints">
                ↻
            </VSCodeButton>
        </CheckpointContainer>
    );
};

export default CheckpointDropdown;
