// Server-Sent Events helper.
//
// Adapts an Express response into a stream of events for a live-progress
// generation. Every sendPhase() call writes one `event: phase` frame; a
// single sendResult() or sendError() closes the stream. The same handler
// can still return plain JSON when the client didn't ask for SSE — use
// createEventChannel(req, res) to pick the right writer automatically.

function write(res, event, data) {
  // One res.write() per frame so tests and any stream reader see the
  // complete `event:` + `data:` pair as a single chunk.
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  if (typeof res.flush === 'function') res.flush();
}

function wantsSSE(req) {
  const accept = String(req.headers?.accept || '').toLowerCase();
  return accept.includes('text/event-stream');
}

/**
 * Pick the right event channel for this request.
 *
 * SSE mode: writes `event: phase`, `event: result`, `event: error` frames
 * and closes the response with res.end().
 *
 * JSON mode: sendPhase() is a no-op, sendResult() does res.json(payload),
 * sendError() sends an HTTP error status with a JSON body.
 *
 * @returns {{
 *   isSSE: boolean,
 *   sendPhase: (phase: string, status: string, detail?: object) => void,
 *   sendResult: (payload: object) => void,
 *   sendError: (err: Error & { status?: number, code?: string }) => void,
 *   onClose: (handler: () => void) => void,
 * }}
 */
export function createEventChannel(req, res) {
  if (wantsSSE(req)) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // Disable proxy buffering so events flush immediately.
      'X-Accel-Buffering': 'no',
    });
    // Initial comment primes the connection with some bytes so any
    // intermediate proxy flushes before the first real event.
    res.write(': stream open\n\n');

    let closed = false;
    const end = () => {
      if (closed) return;
      closed = true;
      res.end();
    };

    return {
      isSSE: true,
      sendPhase(phase, status, detail) {
        if (closed) return;
        write(res, 'phase', { phase, status, ...(detail || {}) });
      },
      // SSE comment frame — keeps the connection alive through proxies
      // (Cloudflare, Railway edge) when no real events are flowing because
      // the server is waiting on a long upstream call. Comments are
      // ignored by EventSource consumers, so callers don't see them.
      sendHeartbeat() {
        if (closed) return;
        res.write(`: heartbeat ${Date.now()}\n\n`);
        if (typeof res.flush === 'function') res.flush();
      },
      sendResult(payload) {
        if (closed) return;
        write(res, 'result', payload);
        end();
      },
      sendError(err) {
        if (closed) return;
        const body = {
          error: err?.message || 'Server error',
          code: err?.code,
          status: err?.status || 500,
        };
        write(res, 'error', body);
        end();
      },
      onClose(handler) {
        req.on('close', () => {
          if (!res.writableEnded) handler();
        });
      },
    };
  }

  // Plain-JSON fallback — preserves the old request/response API for any
  // caller that doesn't opt into streaming.
  let responded = false;
  return {
    isSSE: false,
    sendPhase() {},
    sendHeartbeat() {},
    sendResult(payload) {
      if (responded) return;
      responded = true;
      res.status(200).json(payload);
    },
    sendError(err) {
      if (responded) return;
      responded = true;
      const status = err?.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      res.status(status).json({ error: err?.message || 'Server error' });
    },
    onClose(handler) {
      req.on('close', () => {
        if (!res.writableEnded) handler();
      });
    },
  };
}
