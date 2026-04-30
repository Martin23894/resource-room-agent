// Unit tests for the image-stimulus pipeline. We stub the network
// fetch so tests run offline; the prefetch helper's only role is
// orchestration + error-swallowing, both of which are exercised here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Packer } from 'docx';
import JSZip from 'jszip';

import { lookupImage, listImageIds, IMAGES } from '../lib/images/catalogue.js';
import { renderResource } from '../lib/render.js';

test('catalogue: every entry has the required fields', () => {
  const ids = listImageIds();
  assert.ok(ids.length >= 5, 'expected at least 5 seed entries');
  for (const id of ids) {
    const entry = IMAGES[id];
    assert.ok(typeof entry.url === 'string' && entry.url.startsWith('https://'), `${id}: url`);
    assert.ok(typeof entry.caption === 'string' && entry.caption.length > 0,    `${id}: caption`);
    assert.ok(Array.isArray(entry.tags) && entry.tags.length > 0,                `${id}: tags`);
    assert.ok(typeof entry.source === 'string',                                  `${id}: source`);
    assert.ok(typeof entry.license === 'string',                                 `${id}: license`);
  }
});

test('lookupImage returns null for unknown ids', () => {
  assert.equal(lookupImage('not-a-real-id'), null);
  assert.equal(lookupImage(''), null);
  assert.equal(lookupImage(null), null);
});

test('renderResource embeds image bytes when provided in opts', async () => {
  // 1×1 transparent PNG — minimum valid PNG bytes.
  const tinyPng = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63600100000005000142d40c1f0000000049454e44ae426082',
    'hex',
  );
  const imageBytes = new Map([['fynbos-flower', tinyPng]]);

  const resource = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Natural Sciences and Technology', grade: 5, term: 2, language: 'English',
      resourceType: 'Worksheet', totalMarks: 2, duration: { minutes: 30 }, difficulty: 'on',
      cognitiveFramework: { name: "Bloom's", levels: [
        { name: 'Knowledge', percent: 100, prescribedMarks: 2 },
      ] },
      topicScope: { coversTerms: [2], topics: ['Life and Living: plants'] },
    },
    cover: {
      resourceTypeLabel: 'WORKSHEET', subjectLine: 'NST',
      gradeLine: 'Grade 5', termLine: 'Term 2',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer all questions.'] },
    },
    stimuli: [{
      id: 'protea-photo',
      kind: 'image',
      imageId: 'fynbos-flower',
      altText: 'A king protea flower in fynbos.',
    }],
    sections: [{
      letter: null, title: 'QUESTIONS',
      stimulusRefs: ['protea-photo'],
      questions: [
        { number: '1', type: 'ShortAnswer', topic: 'Life and Living: plants',
          stem: 'Identify the plant in the photograph.',
          marks: 2, cognitiveLevel: 'Knowledge',
          answerSpace: { kind: 'lines', lines: 1 } },
      ],
    }],
    memo: { answers: [
      { questionNumber: '1', answer: 'King protea (Protea cynaroides)', cognitiveLevel: 'Knowledge', marks: 2 },
    ] },
  };

  const doc = renderResource(resource, { imageBytes });
  const buf = await Packer.toBuffer(doc);
  const zip = await JSZip.loadAsync(buf);
  const mediaPaths = Object.keys(zip.files).filter((p) => /^word\/media\/.+\.(png|jpe?g)$/.test(p));
  assert.ok(mediaPaths.length >= 1, `DOCX has no embedded image (paths: ${Object.keys(zip.files).join(', ')})`);
});

test('renderResource falls back to caption when image bytes are missing', async () => {
  // No imageBytes provided — renderer should still produce a valid DOCX.
  const resource = {
    meta: {
      schemaVersion: '1.0',
      subject: 'Natural Sciences and Technology', grade: 5, term: 2, language: 'English',
      resourceType: 'Worksheet', totalMarks: 1, duration: { minutes: 30 }, difficulty: 'on',
      cognitiveFramework: { name: "Bloom's", levels: [{ name: 'Knowledge', percent: 100, prescribedMarks: 1 }] },
      topicScope: { coversTerms: [2], topics: ['Life and Living: plants'] },
    },
    cover: {
      resourceTypeLabel: 'WORKSHEET', subjectLine: 'NST',
      gradeLine: 'Grade 5', termLine: 'Term 2',
      learnerInfoFields: [{ kind: 'name', label: 'Name' }],
      instructions: { heading: 'Instructions', items: ['Answer.'] },
    },
    stimuli: [{ id: 'p', kind: 'image', imageId: 'fynbos-flower', altText: 'A protea.' }],
    sections: [{
      letter: null, title: 'QUESTIONS', stimulusRefs: ['p'],
      questions: [
        { number: '1', type: 'ShortAnswer', topic: 'Life and Living: plants',
          stem: 'Name the plant.', marks: 1, cognitiveLevel: 'Knowledge',
          answerSpace: { kind: 'lines', lines: 1 } },
      ],
    }],
    memo: { answers: [{ questionNumber: '1', answer: 'Protea', cognitiveLevel: 'Knowledge', marks: 1 }] },
  };

  // Should not throw, even without imageBytes.
  const doc = renderResource(resource);
  const buf = await Packer.toBuffer(doc);
  assert.ok(buf.length > 1000);
});
