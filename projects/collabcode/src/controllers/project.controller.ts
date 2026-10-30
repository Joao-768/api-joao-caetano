import type { RequestHandler } from 'express'
import { z } from 'zod'
import * as projectService from '../services/project.service.js'

export const createProjectSchema = z.object({
    name: z.string().min(1).max(80),
})

export const list: RequestHandler = async (req, res) => {
    const projects = await projectService.listProjects(req.user!.id)
    res.json({ projects })
}

export const create: RequestHandler = async (req, res) => {
    const { name } = req.body as z.infer<typeof createProjectSchema>
    const project = await projectService.createProject(req.user!.id, name)
    res.status(201).json({ project })
}

export const get: RequestHandler = async (req, res) => {
    const project = await projectService.getProject(req.params.id as string, req.user!.id)
    res.json({ project })
}

export const join: RequestHandler = async (req, res) => {
    const project = await projectService.joinProject(req.params.id as string, req.user!.id)
    res.json({ project })
}

export const remove: RequestHandler = async (req, res) => {
    await projectService.deleteProject(req.params.id as string, req.user!.id)
    res.status(204).end()
}
