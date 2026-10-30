import * as Y from 'yjs'
import { Prisma } from '@prisma/client'
import { prisma } from '../lib/prisma.js'

const SAVE_DEBOUNCE_MS = 2000

type LoadedDoc = {
    doc: Y.Doc
    saveTimer: NodeJS.Timeout | null
    subscribers: number
}

const docs = new Map<string, LoadedDoc>()

export async function loadDoc(fileId: string): Promise<Y.Doc> {
    const existing = docs.get(fileId)

    if (existing) {
        existing.subscribers += 1
        return existing.doc
    }

    const file = await prisma.file.findUnique({
        where: { id: fileId },
        select: { ydoc: true, content: true },
    })

    const doc = new Y.Doc()

    if (file?.ydoc) {
        Y.applyUpdate(doc, new Uint8Array(file.ydoc))
    } else if (file?.content) {
        doc.getText('content').insert(0, file.content)
    }

    docs.set(fileId, { doc, saveTimer: null, subscribers: 1 })

    return doc
}

export function applyUpdate(fileId: string, update: Uint8Array): void {
    const entry = docs.get(fileId)
    if (!entry) return

    Y.applyUpdate(entry.doc, update)
    scheduleSave(fileId)
}

export function encodeState(doc: Y.Doc): Uint8Array {
    return Y.encodeStateAsUpdate(doc)
}

function scheduleSave(fileId: string): void {
    const entry = docs.get(fileId)
    if (!entry) return

    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer)
    }

    entry.saveTimer = setTimeout(() => {
        persist(fileId).catch((error: unknown) => {
            console.error(`Failed to persist file ${fileId}:`, error)
        })
    }, SAVE_DEBOUNCE_MS)
}

export async function persist(fileId: string): Promise<void> {
    const entry = docs.get(fileId)
    if (!entry) return

    if (entry.saveTimer) {
        clearTimeout(entry.saveTimer)
        entry.saveTimer = null
    }

    const state = Y.encodeStateAsUpdate(entry.doc)
    const content = entry.doc.getText('content').toString()

    try {
        await prisma.file.update({
            where: { id: fileId },
            data: { ydoc: Buffer.from(state), content },
        })
    } catch (error) {
        // The file may have been deleted while someone still had it open.
        // Drop the in-memory doc instead of crashing the process.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
            entry.doc.destroy()
            docs.delete(fileId)
            return
        }

        throw error
    }
}

export async function releaseDoc(fileId: string): Promise<void> {
    const entry = docs.get(fileId)
    if (!entry) return

    entry.subscribers -= 1

    if (entry.subscribers <= 0) {
        await persist(fileId)
        entry.doc.destroy()
        docs.delete(fileId)
    }
}

export async function persistAll(): Promise<void> {
    await Promise.all([...docs.keys()].map((fileId) => persist(fileId)))
}
