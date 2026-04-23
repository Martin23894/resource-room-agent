import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import rebuildHandler from '../api/rebuild-docx.js';

function makeReq(body) {
  const req = new EventEmitter();
  req.method = 'POST';
  req.body = body;
  req.headers = {};
  req.log = { info: () => {}, warn: () => {}, error: () => {} };
  return req;
}

function makeRes() {
  const res = new EventEmitter();
  res.statusCode = null;
  res.jsonBody = null;
  res.headers = {};
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (body) => { res.jsonBody = body; return res; };
  res.set = (k, v) => { res.headers[k] = v; return res; };
  return res;
}

const VALID_BODY = {
  subject: 'Mathematics',
  resourceType: 'Test',
  language: 'English',
  difficulty: 'on',
  duration: 50,
  grade: 6,
  term: 3,
  includeRubric: false,
  preview: [
    'Question 1: Fractions',
    '',
    '1.1 Calculate 1/2 + 1/3. (2)',
    '_______________________________________________',
    '_______________________________________________',
    '',
    'TOTAL: _____ / 50 marks',
    '',
    'MEMORANDUM',
    '',
    '| NO. | ANSWER | MARKING GUIDANCE | COGNITIVE LEVEL | MARK |',
    '| 1.1 | 5/6    | accept equivalent | Routine         | 2   |',
    '',
    'TOTAL: 50 marks',
  ].join('\n'),
};

describe('POST /api/rebuild-docx', () => {
  test('returns a base64 DOCX + filename for a valid body', async () => {
    const req = makeReq(VALID_BODY);
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonBody.docxBase64, 'should return docxBase64');
    assert.match(res.jsonBody.filename, /\.docx$/);
    // A real DOCX header (PK zip signature) base64-starts with "UEsDB".
    assert.ok(res.jsonBody.docxBase64.startsWith('UEsDB'),
      'should look like a real DOCX zip (PK header)');
  });

  test('rejects non-POST requests', async () => {
    const req = makeReq(VALID_BODY);
    req.method = 'GET';
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 405);
  });

  test('rejects missing subject with a 400 and field-specific message', async () => {
    const req = makeReq({ ...VALID_BODY, subject: '' });
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /subject/i);
  });

  test('rejects out-of-range grade', async () => {
    const req = makeReq({ ...VALID_BODY, grade: 99 });
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /grade/i);
  });

  test('rejects empty preview', async () => {
    const req = makeReq({ ...VALID_BODY, preview: '' });
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /preview/i);
  });

  test('rejects excessively long preview (>100kb)', async () => {
    const huge = 'A'.repeat(100001);
    const req = makeReq({ ...VALID_BODY, preview: huge });
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.match(res.jsonBody.error, /preview/i);
  });

  test('handles preview without a MEMORANDUM heading (paper only)', async () => {
    const paperOnly = [
      'Question 1',
      '1.1 Short question. (2)',
      'TOTAL: _____ / 50 marks',
    ].join('\n');
    const req = makeReq({ ...VALID_BODY, preview: paperOnly });
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(res.jsonBody.docxBase64);
  });

  test('returns the mark total extracted from the edited paper', async () => {
    const req = makeReq(VALID_BODY);
    const res = makeRes();
    await rebuildHandler(req, res);
    assert.equal(res.statusCode, 200);
    // The one sub-question is worth 2 marks; countMarks finds it.
    assert.equal(res.jsonBody.markTotal, 2);
  });
});
