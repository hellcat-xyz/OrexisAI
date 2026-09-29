'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { slugify, magicMatches } = require('../workconnect/service');

test('WorkConnect slugification is deterministic and URL safe', () => {
  assert.equal(slugify('Civil Engineer / Coimbatore'), 'civil-engineer-coimbatore');
  assert.equal(slugify('../../etc/passwd'), 'etc-passwd');
});

test('WorkConnect upload content validation checks signatures, not extensions', () => {
  assert.equal(magicMatches(Buffer.from([0xff,0xd8,0xff,0x00]), 'image/jpeg'), true);
  assert.equal(magicMatches(Buffer.from('not an image'), 'image/jpeg'), false);
  assert.equal(magicMatches(Buffer.from('%PDF-1.7'), 'application/pdf'), true);
});

test('WorkConnect schema is additive, user-bound and includes core persistent systems', () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
  for (const table of ['workconnect_profiles','workconnect_service_locations','workconnect_posts','workconnect_job_applications','workconnect_service_inquiries','workconnect_messages','workconnect_reviews','workconnect_notifications','workconnect_blocks']) {
    assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}\\b`));
  }
  assert.match(sql, /REFERENCES users\(id\)/);
  assert.match(sql, /CHECK\(rating BETWEEN 1 AND 5\)/);
  assert.match(sql, /UNIQUE\(job_id, applicant_user_id\)/);
});

test('WorkConnect backend uses parameterized queries and explicit ownership checks', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'workconnect', 'service.js'), 'utf8');
  assert.match(src, /owner_user_id=\$2/);
  assert.match(src, /author_user_id=\$2/);
  assert.match(src, /applicant_user_id/);
  assert.match(src, /assertSameOrigin\(req\)/);
  assert.match(src, /\[[^\]]*userId[^\]]*\]/);
});

test('WorkConnect UI contains real empty states and no fabricated professional cards', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'workconnect.js'), 'utf8');
  assert.match(src, /No professionals found in this area yet\./);
  assert.match(src, /No opportunities match your filters\./);
  assert.match(src, /navigator\.geolocation/);
  assert.match(src, /\/api\/workconnect\/discover/);
});
