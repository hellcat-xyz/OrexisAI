'use strict';

const crypto = require('node:crypto');
const { promisify } = require('node:util');

const scrypt = promisify(crypto.scrypt);
const password = process.argv[2];

if (!password) {
    console.error('Usage: node scripts/hash-password.js "your strong password"');
    process.exit(1);
}

(async () => {
    const salt = crypto.randomBytes(16).toString('hex');
    const digest = await scrypt(password, salt, 64);
    console.log(`scrypt$${salt}$${digest.toString('hex')}`);
})().catch((error) => {
    console.error('Unable to generate password hash:', error.message);
    process.exit(1);
});
