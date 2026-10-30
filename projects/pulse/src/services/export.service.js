// CSV exports. Checks are streamed in keyset-paginated batches so a year of
// 30-second checks never sits in memory at once.

import * as checkRepository from '../repositories/check.repository.js'
import * as incidentRepository from '../repositories/incident.repository.js'
import { formatDuration } from '../utils/duration.js'

const BATCH = 5000

// Quotes a value for CSV and neutralizes spreadsheet formula injection
// (cells starting with = + - @ would otherwise run as formulas in Excel).
export function csvCell(value) {
    if (value === null || value === undefined) return ''
    let text = value instanceof Date ? value.toISOString() : String(value)
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function csvRow(values) {
    return values.map(csvCell).join(',') + '\r\n'
}

export async function writeChecksCsv(stream, monitorId, from, to) {
    stream.write(
        csvRow([
            'checked_at',
            'result',
            'type',
            'status_code',
            'response_time_ms',
            'error_type',
            'error_message',
        ]),
    )

    let after = null
    for (;;) {
        const rows = await checkRepository.exportBatch(monitorId, from, to, after, BATCH)
        if (rows.length === 0) break
        let chunk = ''
        for (const row of rows) {
            chunk += csvRow([
                row.checked_at,
                row.status,
                row.is_retry ? 'retry' : 'normal',
                row.status_code,
                row.response_time,
                row.error_type,
                row.error_message,
            ])
        }
        stream.write(chunk)
        const last = rows.at(-1)
        after = { checkedAt: last.checked_at, id: last.id }
        if (rows.length < BATCH) break
    }
}

export async function writeIncidentsCsv(stream, monitorId, from, to) {
    const now = new Date()
    const incidents = await incidentRepository.exportForMonitor(monitorId, from, to)
    stream.write(
        csvRow([
            'started_at',
            'resolved_at',
            'state',
            'resolution',
            'duration_seconds',
            'duration',
            'reason',
        ]),
    )
    for (const incident of incidents.reverse()) {
        const end = incident.resolved_at ?? now
        const durationMs = end - incident.started_at
        stream.write(
            csvRow([
                incident.started_at,
                incident.resolved_at,
                incident.resolved_at ? 'resolved' : 'active',
                incident.resolution,
                Math.round(durationMs / 1000),
                formatDuration(durationMs),
                incident.reason,
            ]),
        )
    }
}
