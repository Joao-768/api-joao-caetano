import type { RequestHandler } from 'express'
import * as messageService from '../services/message.service.js'

export const list: RequestHandler = async (req, res) => {
    const messages = await messageService.listMessages(req.params.id as string, req.user!.id)
    res.json({ messages })
}
