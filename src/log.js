// One JSON line per event, the format Render's log viewer searches best.
export function log(level, message, fields = {}) {
    const line = JSON.stringify({ level, time: new Date().toISOString(), msg: message, ...fields })
    if (level === 'error') console.error(line)
    else console.log(line)
}

export function errorFields(error) {
    if (error instanceof Error) return { error: error.message, stack: error.stack }
    return { error: String(error) }
}
