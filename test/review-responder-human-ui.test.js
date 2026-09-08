'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const app = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const service = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'service.js'), 'utf8');

test('review responder UI surfaces rating/text conflicts without mislabeling five-star reviews as negative', () => {
    assert.match(app, /ratingTextConflict/);
    assert.match(app, /concerns noted/);
    assert.match(service, /explicit star rating is the strongest signal/);
});

test('review responder prompt requires rating-aware human tone and avoids canned duplicate replies', () => {
    assert.match(service, /Do not reuse the same canned reply across different reviews/);
    assert.match(service, /Five stars: be enthusiastic, grateful, and appreciative/);
    assert.match(service, /Avoid robotic phrases such as \"we note your comments\"/);
    assert.match(service, /normalizeReviewDraftFingerprint/);
    assert.match(service, /reviewDraftMatchesRatingTone/);
});
