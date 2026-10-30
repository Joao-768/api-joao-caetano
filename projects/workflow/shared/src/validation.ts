import type { z } from 'zod'
import { findTemplatePaths } from './template'
import { normalizePath } from './paths'
import { ancestorsOf, findCycle, findTrigger, outgoingEdges, reachableFrom } from './graph'
import {
    workflowDefinitionSchema,
    workflowNodeSchema,
    type ValidWorkflowDefinition,
    type WorkflowDefinition,
    type WorkflowNode,
} from './definition'

/**
 * Checks that a workflow graph is safe to execute. Everything the engine
 * relies on at runtime is verified here, up front, so that a broken graph is
 * rejected in the builder instead of failing halfway through an execution:
 *
 *   - exactly one trigger, and nothing points back into it
 *   - every edge connects two existing nodes
 *   - conditions leave through "true" / "false", other nodes through one edge
 *   - no cycles (this version has no loops)
 *   - every node is reachable from the trigger
 *   - every node's configuration is complete and well-formed
 *   - `{{steps.<id>}}` references point at a node that runs earlier
 */

export type ValidationIssue = {
    message: string
    nodeId?: string
    edgeId?: string
    field?: string
}

export type ValidationResult =
    | { valid: true; issues: []; definition: ValidWorkflowDefinition }
    | { valid: false; issues: ValidationIssue[] }

export function validateDefinition(input: unknown): ValidationResult {
    const shape = workflowDefinitionSchema.safeParse(input)
    if (!shape.success) {
        return { valid: false, issues: structuralIssues(input, shape.error) }
    }

    const graph = shape.data
    const issues: ValidationIssue[] = [
        ...checkIds(graph),
        ...checkTrigger(graph),
        ...checkEdges(graph),
    ]

    // Cycle and reachability checks assume the edges make sense.
    if (issues.length === 0) issues.push(...checkTopology(graph))

    const typedNodes: WorkflowNode[] = []
    for (const node of graph.nodes) {
        const parsed = workflowNodeSchema.safeParse(node)
        if (parsed.success) {
            typedNodes.push(parsed.data)
        } else {
            issues.push(...configIssues(node.id, parsed.error))
        }
    }

    if (issues.length === 0) issues.push(...checkReferences(graph, typedNodes))

    if (issues.length > 0) return { valid: false, issues }
    return { valid: true, issues: [], definition: { nodes: typedNodes, edges: graph.edges } }
}

function checkIds(graph: WorkflowDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const seenNodes = new Set<string>()
    for (const node of graph.nodes) {
        if (seenNodes.has(node.id)) {
            issues.push({ nodeId: node.id, message: `Two nodes share the id "${node.id}"` })
        }
        seenNodes.add(node.id)
    }
    const seenEdges = new Set<string>()
    for (const edge of graph.edges) {
        if (seenEdges.has(edge.id)) {
            issues.push({ edgeId: edge.id, message: `Two edges share the id "${edge.id}"` })
        }
        seenEdges.add(edge.id)
    }
    return issues
}

function checkTrigger(graph: WorkflowDefinition): ValidationIssue[] {
    const triggers = graph.nodes.filter((node) => node.type === 'trigger')
    if (triggers.length === 0) return [{ message: 'A workflow needs a trigger node' }]
    if (triggers.length > 1) {
        return triggers.slice(1).map((node) => ({
            nodeId: node.id,
            message: 'A workflow can only have one trigger',
        }))
    }
    if (outgoingEdges(graph, triggers[0].id).length === 0) {
        return [{ nodeId: triggers[0].id, message: 'Connect the trigger to the first step' }]
    }
    return []
}

function checkEdges(graph: WorkflowDefinition): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const byId = new Map(graph.nodes.map((node) => [node.id, node]))
    const usedExits = new Set<string>()

    for (const edge of graph.edges) {
        const source = byId.get(edge.source)
        const target = byId.get(edge.target)

        if (!source || !target) {
            issues.push({
                edgeId: edge.id,
                message: 'This connection points at a node that does not exist',
            })
            continue
        }
        if (edge.source === edge.target) {
            issues.push({
                edgeId: edge.id,
                nodeId: edge.source,
                message: 'A node cannot connect to itself',
            })
            continue
        }
        if (target.type === 'trigger') {
            issues.push({
                edgeId: edge.id,
                nodeId: target.id,
                message: 'Nothing can connect into the trigger',
            })
            continue
        }

        if (source.type === 'condition' && !edge.sourceHandle) {
            issues.push({
                edgeId: edge.id,
                nodeId: source.id,
                message: 'Condition connections must leave from the true or false handle',
            })
            continue
        }
        if (source.type !== 'condition' && edge.sourceHandle) {
            issues.push({
                edgeId: edge.id,
                nodeId: source.id,
                message: 'Only conditions have true / false outputs',
            })
            continue
        }

        // One edge per exit: a single path through the graph at any time.
        const exit = `${edge.source}:${edge.sourceHandle ?? 'out'}`
        if (usedExits.has(exit)) {
            issues.push({
                edgeId: edge.id,
                nodeId: source.id,
                message: edge.sourceHandle
                    ? `The ${edge.sourceHandle} branch can only lead to one node`
                    : 'This node can only lead to one next node',
            })
        }
        usedExits.add(exit)
    }
    return issues
}

function checkTopology(graph: WorkflowDefinition): ValidationIssue[] {
    const cycle = findCycle(graph)
    if (cycle) {
        return [{ nodeId: cycle[0], message: `Loops are not supported: ${cycle.join(' → ')}` }]
    }

    const trigger = findTrigger(graph)
    if (!trigger) return []

    const reachable = reachableFrom(graph, trigger.id)
    return graph.nodes
        .filter((node) => !reachable.has(node.id))
        .map((node) => ({ nodeId: node.id, message: 'This node is not connected to the trigger' }))
}

function checkReferences(graph: WorkflowDefinition, nodes: WorkflowNode[]): ValidationIssue[] {
    const issues: ValidationIssue[] = []
    const ids = new Set(nodes.map((node) => node.id))

    for (const node of nodes) {
        const paths = findTemplatePaths(node.config)
        if (node.type === 'condition') {
            try {
                paths.push(normalizePath(node.config.path).join('.'))
            } catch {
                issues.push({
                    nodeId: node.id,
                    field: 'path',
                    message: `"${node.config.path}" is not a valid path`,
                })
                continue
            }
        }

        const upstream = ancestorsOf(graph, node.id)
        for (const path of paths) {
            const [root, stepId] = path.split('.')
            if (root !== 'steps') continue
            if (!stepId || !ids.has(stepId)) {
                issues.push({
                    nodeId: node.id,
                    message: `{{${path}}} refers to a node that does not exist`,
                })
            } else if (!upstream.has(stepId)) {
                issues.push({
                    nodeId: node.id,
                    message: `{{${path}}} refers to "${stepId}", which does not run before this node`,
                })
            }
        }
    }
    return issues
}

function configIssues(nodeId: string, error: z.ZodError): ValidationIssue[] {
    return error.issues.map((issue) => {
        // Paths look like ["config", "cron"]: report the config field.
        const field =
            issue.path[0] === 'config' ? issue.path.slice(1).join('.') : issue.path.join('.')
        return { nodeId, field: field || undefined, message: issue.message }
    })
}

function structuralIssues(input: unknown, error: z.ZodError): ValidationIssue[] {
    const nodes = Array.isArray((input as { nodes?: unknown })?.nodes)
        ? (input as { nodes: { id?: unknown }[] }).nodes
        : []

    return error.issues.map((issue) => {
        const [collection, index, ...rest] = issue.path
        if (collection === 'nodes' && typeof index === 'number') {
            const id = nodes[index]?.id
            return {
                nodeId: typeof id === 'string' ? id : undefined,
                field: rest.join('.') || undefined,
                message: issue.message,
            }
        }
        return { message: `${issue.path.join('.') || 'definition'}: ${issue.message}` }
    })
}
