import * as notificationRepository from '../repositories/notification.repository.js'
import { badRequest, notFound } from '../utils/errors.js'
import { isUuid, parsePage } from '../utils/validate.js'

const PAGE_SIZE = 30

function toPublic(row) {
    return {
        id: row.id,
        type: row.type,
        message: row.message,
        isRead: row.is_read,
        createdAt: row.created_at,
        monitorId: row.monitor_id,
        monitorName: row.monitor_name ?? null,
    }
}

export async function list(req, res) {
    const page = parsePage(req.query.page)
    const [{ items, total }, unread] = await Promise.all([
        notificationRepository.listForUser(req.user.id, {
            unreadOnly: req.query.unread === 'true',
            limit: PAGE_SIZE,
            offset: (page - 1) * PAGE_SIZE,
        }),
        notificationRepository.countUnread(req.user.id),
    ])
    res.json({ items: items.map(toPublic), page, pageSize: PAGE_SIZE, total, unread })
}

export async function unreadCount(req, res) {
    res.json({ unread: await notificationRepository.countUnread(req.user.id) })
}

export async function update(req, res) {
    if (!isUuid(req.params.id)) throw notFound('Notification not found.')
    if (typeof req.body?.isRead !== 'boolean') throw badRequest('isRead must be true or false.')
    const row = await notificationRepository.setRead(req.params.id, req.user.id, req.body.isRead)
    if (!row) throw notFound('Notification not found.')
    res.json({ notification: toPublic(row) })
}

export async function markAllRead(req, res) {
    const updated = await notificationRepository.markAllRead(req.user.id)
    res.json({ updated })
}
