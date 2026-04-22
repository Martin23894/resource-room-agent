import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { createEventChannel } from '../lib/sse.js';

// Minimal req/res doubles that just record writes/status calls.
function makeReqRes({ accept } = {}) {
  const req = new EventEmitter();
  req.headers = accept ? { accept } : {};

  const res = new EventEmitter();
  res.written = [];
  res.headers = {};
  res.statusCode = null;
  res.writableEnded = false;
  res.jsonBody = null;

  res.writeHead = (code, headers) => {
    res.statusCode = code;
    Object.assign(res.headers, headers || {});
  };
  res.write = (chunk) => { res.written.push(String(chunk)); };
  res.end = () => { res.writableEnded = true; };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (body) => { res.jsonBody = body; res.writableEnded = true; };
  return { req, res };
}

describe('createEventChannel — SSE mode', () => {
  test('detects text/event-stream and primes the stream', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    assert.equal(ch.isSSE, true);
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(res.headers['Cache-Control'], 'no-cache, no-transform');
    assert.equal(res.headers['X-Accel-Buffering'], 'no');
    assert.ok(res.written[0].startsWith(':'), 'first write should be an SSE comment');
  });

  test('sendPhase writes a phase event frame', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    ch.sendPhase('plan', 'done', { questions: 8 });
    const frame = res.written[res.written.length - 1];
    assert.match(frame, /^event: phase\n/);
    assert.match(frame, /data: \{"phase":"plan","status":"done","questions":8\}/);
    assert.ok(frame.endsWith('\n\n'), 'SSE frames end with a blank line');
  });

  test('sendResult writes a result event and closes the response', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    ch.sendResult({ docxBase64: 'x', preview: 'y' });
    const last = res.written[res.written.length - 1];
    assert.match(last, /^event: result\n/);
    assert.match(last, /"docxBase64":"x"/);
    assert.equal(res.writableEnded, true);
  });

  test('sendError writes an error event and closes', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    const err = Object.assign(new Error('boom'), { status: 500 });
    ch.sendError(err);
    const last = res.written[res.written.length - 1];
    assert.match(last, /^event: error\n/);
    assert.match(last, /"error":"boom"/);
    assert.equal(res.writableEnded, true);
  });

  test('does not write more events after close', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    ch.sendResult({ done: true });
    const writesAfterEnd = res.written.length;
    ch.sendPhase('after', 'done'); // should be a no-op
    ch.sendError(new Error('too late'));
    assert.equal(res.written.length, writesAfterEnd, 'no writes after end()');
  });
});

describe('createEventChannel — JSON fallback', () => {
  test('falls back when Accept does not include text/event-stream', () => {
    const { req, res } = makeReqRes({ accept: 'application/json' });
    const ch = createEventChannel(req, res);
    assert.equal(ch.isSSE, false);
    ch.sendPhase('plan', 'done'); // no-op
    ch.sendResult({ docxBase64: 'x' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.jsonBody, { docxBase64: 'x' });
  });

  test('sendError uses err.status for the HTTP code when sensible', () => {
    const { req, res } = makeReqRes({});
    const ch = createEventChannel(req, res);
    ch.sendError(Object.assign(new Error('bad input'), { status: 400 }));
    assert.equal(res.statusCode, 400);
    assert.equal(res.jsonBody.error, 'bad input');
  });

  test('defaults to 500 when status is missing or out of range', () => {
    const { req, res } = makeReqRes({});
    const ch = createEventChannel(req, res);
    ch.sendError(new Error('generic'));
    assert.equal(res.statusCode, 500);
  });

  test('sendResult is idempotent — a second call is a no-op', () => {
    const { req, res } = makeReqRes({});
    const ch = createEventChannel(req, res);
    ch.sendResult({ a: 1 });
    ch.sendResult({ b: 2 });
    assert.deepEqual(res.jsonBody, { a: 1 });
  });
});

describe('createEventChannel — onClose', () => {
  test('invokes handler when the request fires close before response ends', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    let fired = false;
    ch.onClose(() => { fired = true; });
    req.emit('close');
    assert.equal(fired, true);
  });

  test('does NOT invoke handler if response already ended', () => {
    const { req, res } = makeReqRes({ accept: 'text/event-stream' });
    const ch = createEventChannel(req, res);
    let fired = false;
    ch.onClose(() => { fired = true; });
    ch.sendResult({ ok: true }); // sets writableEnded = true
    req.emit('close');
    assert.equal(fired, false, 'close after end is a normal lifecycle event, not a cancel');
  });
});
