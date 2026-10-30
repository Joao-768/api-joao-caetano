import type { BranchHandle } from './constants'
import type { WorkflowEdge } from './definition'

/**
 * Pure graph helpers. They work on anything shaped like { nodes, edges } so
 * the validator can use them on drafts and the engine on validated graphs.
 */

type GraphLike = {
    nodes: { id: string; type: string }[]
    edges: WorkflowEdge[]
}

export function findTrigger<G extends GraphLike>(graph: G): G['nodes'][number] | undefined {
    return graph.nodes.find((node) => node.type === 'trigger')
}

export function outgoingEdges(graph: GraphLike, nodeId: string): WorkflowEdge[] {
    return graph.edges.filter((edge) => edge.source === nodeId)
}

/**
 * The node that runs after `nodeId`. For a condition, `handle` says which
 * branch was taken; every other node has at most one way out. Returns null
 * when the path ends here.
 */
export function nextNodeId(graph: GraphLike, nodeId: string, handle?: BranchHandle): string | null {
    const edge = outgoingEdges(graph, nodeId).find((candidate) =>
        handle ? candidate.sourceHandle === handle : !candidate.sourceHandle,
    )
    return edge?.target ?? null
}

/** Every node reachable from `startId`, including itself. */
export function reachableFrom(graph: GraphLike, startId: string): Set<string> {
    const seen = new Set<string>()
    const stack = [startId]
    while (stack.length > 0) {
        const id = stack.pop()!
        if (seen.has(id)) continue
        seen.add(id)
        for (const edge of outgoingEdges(graph, id)) stack.push(edge.target)
    }
    return seen
}

/** Every node that can run before `nodeId` on some path (not including itself). */
export function ancestorsOf(graph: GraphLike, nodeId: string): Set<string> {
    const seen = new Set<string>()
    const stack = [nodeId]
    while (stack.length > 0) {
        const id = stack.pop()!
        for (const edge of graph.edges) {
            if (edge.target === id && !seen.has(edge.source)) {
                seen.add(edge.source)
                stack.push(edge.source)
            }
        }
    }
    return seen
}

/**
 * Returns the ids along one cycle if the graph has any, otherwise null.
 * Classic depth-first search with three colours: a node we meet again while
 * it is still on the stack ("visiting") closes a loop.
 */
export function findCycle(graph: GraphLike): string[] | null {
    const state = new Map<string, 'visiting' | 'done'>()
    const path: string[] = []

    const visit = (id: string): string[] | null => {
        state.set(id, 'visiting')
        path.push(id)
        for (const edge of outgoingEdges(graph, id)) {
            const mark = state.get(edge.target)
            if (mark === 'visiting') return [...path.slice(path.indexOf(edge.target)), edge.target]
            if (!mark) {
                const cycle = visit(edge.target)
                if (cycle) return cycle
            }
        }
        path.pop()
        state.set(id, 'done')
        return null
    }

    for (const node of graph.nodes) {
        if (!state.has(node.id)) {
            const cycle = visit(node.id)
            if (cycle) return cycle
        }
    }
    return null
}
