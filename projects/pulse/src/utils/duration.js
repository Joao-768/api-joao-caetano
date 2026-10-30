// "2h 14m", "45s", "3d 4h". Used in notification messages and CSV exports.
export function formatDuration(ms) {
    const totalSeconds = Math.max(0, Math.round(ms / 1000))
    const days = Math.floor(totalSeconds / 86400)
    const hours = Math.floor((totalSeconds % 86400) / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    if (days > 0) return hours ? `${days}d ${hours}h` : `${days}d`
    if (hours > 0) return minutes ? `${hours}h ${minutes}m` : `${hours}h`
    if (minutes > 0) return seconds && minutes < 10 ? `${minutes}m ${seconds}s` : `${minutes}m`
    return `${seconds}s`
}
