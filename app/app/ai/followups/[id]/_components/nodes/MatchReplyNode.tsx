"use client";

import type { NodeProps } from "@xyflow/react";

import type { RFNode } from "@/lib/followup/graph-mappers";
import { nodeBranches } from "@/lib/followup/graph-schema";
import type { ConfigOf } from "../forms/shared";
import { NODE_VISUALS, describeNodeConfig } from "./nodeVisuals";
import { NodeCard } from "./NodeCard";

export function MatchReplyNode({ id, data, selected }: NodeProps<RFNode>) {
  return (
    <NodeCard
      id={id}
      visual={NODE_VISUALS.match_reply}
      label={data.label}
      subtitle={describeNodeConfig("match_reply", data.config)}
      selected={selected}
      errors={data.errors}
      branches={nodeBranches({ type: "match_reply", config: data.config as ConfigOf<"match_reply"> })}
    />
  );
}
