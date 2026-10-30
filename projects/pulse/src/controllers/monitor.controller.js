import * as checkRepository from '../repositories/check.repository.js'
import * as incidentRepository from '../repositories/incident.repository.js'
import * as monitorRepository from '../repositories/monitor.repository.js'
import * as exportService from '../services/export.service.js'
import * as metricsService from '../services/metrics.service.js'
import * as monitorService from '../services/monitor.service.js'
import { resolvePeriod } from '../services/period.js'
import { parsePage } from '../utils/validate.js'

const CHECKS_PAGE_SIZE = 25

export async function list(req, res) {
    const monitors = await monitorRepository.listByUser(req.user.id)
    res.json({ items: monitors.map(monitorService.toPublicMonitor) })
}

// Dashboard: every monitor with its last 24 hours.
export async function dashboard(req, res) {
    res.json(await metricsService.getDashboard(req.user.id))
}

export async function create(req, res) {
    const monitor = await monitorService.createMonitor(req.user.id, req.body ?? {})
    res.status(201).json({ monitor: monitorService.toPublicMonitor(monitor) })
}

export async function get(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    const [latest] = await checkRepository.latestForMonitors([monitor.id])
    const now = new Date()
    const [active] = (
        await incidentRepository.listOverlapping([monitor.id], now, new Date(now.getTime() + 1))
    ).filter((incident) => !incident.resolved_at)

    res.json({
        monitor: monitorService.toPublicMonitor(monitor),
        lastCheck: latest ? metricsService.toPublicCheck(latest) : null,
        activeIncident: active ? metricsService.toPublicIncident(active, now) : null,
    })
}

export async function rename(req, res) {
    const monitor = await monitorService.renameMonitor(req.user.id, req.params.id, req.body ?? {})
    res.json({ monitor: monitorService.toPublicMonitor(monitor) })
}

export async function remove(req, res) {
    await monitorService.deleteMonitor(req.user.id, req.params.id)
    res.status(204).end()
}

export async function pause(req, res) {
    const monitor = await monitorService.pauseMonitor(req.user.id, req.params.id)
    res.json({ monitor: monitorService.toPublicMonitor(monitor) })
}

export async function resume(req, res) {
    const monitor = await monitorService.resumeMonitor(req.user.id, req.params.id)
    res.json({ monitor: monitorService.toPublicMonitor(monitor) })
}

export async function metrics(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    res.json(await metricsService.getMonitorMetrics(monitor, req.user.plan, req.query.period))
}

function periodFor(req, monitor) {
    return resolvePeriod(req.query.period, {
        plan: req.user.plan,
        monitorCreatedAt: monitor.created_at,
    })
}

export async function checks(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    const period = periodFor(req, monitor)
    const page = parsePage(req.query.page)
    const filter = ['all', 'failures', 'retries'].includes(req.query.filter)
        ? req.query.filter
        : 'all'

    const { items, total } = await checkRepository.listPage(monitor.id, {
        from: period.from,
        to: period.to,
        filter,
        limit: CHECKS_PAGE_SIZE,
        offset: (page - 1) * CHECKS_PAGE_SIZE,
    })
    res.json({
        items: items.map(metricsService.toPublicCheck),
        page,
        pageSize: CHECKS_PAGE_SIZE,
        total,
    })
}

export async function incidents(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    const period = periodFor(req, monitor)
    const rows = await incidentRepository.listOverlapping([monitor.id], period.from, period.to)
    const now = new Date()
    res.json({ items: rows.map((row) => metricsService.toPublicIncident(row, now)) })
}

function safeFileName(name) {
    return (
        name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '') || 'monitor'
    )
}

function startCsv(res, monitor, kind, period) {
    const date = new Date().toISOString().slice(0, 10)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeFileName(monitor.name)}-${kind}-${period.key}-${date}.csv"`,
    )
    // Byte order mark so spreadsheet apps read UTF-8 correctly.
    res.write('﻿')
}

export async function exportChecks(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    const period = periodFor(req, monitor)
    startCsv(res, monitor, 'checks', period)
    await exportService.writeChecksCsv(res, monitor.id, period.from, period.to)
    res.end()
}

export async function exportIncidents(req, res) {
    const monitor = await monitorService.getOwnedMonitor(req.user.id, req.params.id)
    const period = periodFor(req, monitor)
    startCsv(res, monitor, 'incidents', period)
    await exportService.writeIncidentsCsv(res, monitor.id, period.from, period.to)
    res.end()
}
