import * as incidentRepository from '../repositories/incident.repository.js'
import { toPublicIncident } from '../services/metrics.service.js'
import { parsePage } from '../utils/validate.js'

const PAGE_SIZE = 25

export async function list(req, res) {
    const status = ['active', 'resolved'].includes(req.query.status) ? req.query.status : 'all'
    const page = parsePage(req.query.page)
    const { items, total } = await incidentRepository.listForUser(req.user.id, {
        status,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
    })
    const now = new Date()
    res.json({
        items: items.map((row) => toPublicIncident(row, now)),
        page,
        pageSize: PAGE_SIZE,
        total,
    })
}
