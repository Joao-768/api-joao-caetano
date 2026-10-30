// The monitor state machine, as a pure function so it can be unit tested and
// reused by any runner (cron today, a queue worker tomorrow).
//
//   check ok                      -> UP (closes the incident if it was DOWN)
//   normal check fails, not DOWN  -> keep status, schedule one retry
//   retry fails                   -> DOWN, open incident, notify
//   check fails while DOWN        -> stay DOWN, no new incident, no retry
//
// Exactly one retry per failure streak, so retries can never loop.

export function decideTransition(currentStatus, success, isRetry) {
    if (success) {
        return {
            status: 'UP',
            retryPending: false,
            openIncident: false,
            closeIncident: currentStatus === 'DOWN',
        }
    }

    if (currentStatus === 'DOWN') {
        return { status: 'DOWN', retryPending: false, openIncident: false, closeIncident: false }
    }

    if (!isRetry) {
        // UP or PENDING: not declared down yet, confirm with a retry first.
        return {
            status: currentStatus,
            retryPending: true,
            openIncident: false,
            closeIncident: false,
        }
    }

    return { status: 'DOWN', retryPending: false, openIncident: true, closeIncident: false }
}
