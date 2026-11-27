// test/deploy.test.js
//
// Checkpoint 7: the session secret. In production the app must have a real
// SESSION_SECRET (generated on the server by deploy/setup-ec2.sh and passed
// in by systemd), and must refuse to start on the public fallback. These
// tests cover that rule, plus checks that the deploy files still wire the
// secret through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

process.env.DATA_FILE = path.join(os.tmpdir(), `black-forest-test-${process.pid}-deploy.db`);

const { createApp } = await import('../server/app.js');

function withEnv(values, run) {
    const saved = {};
    for (const key of Object.keys(values)) {
        saved[key] = process.env[key];
        if (values[key] === undefined) delete process.env[key]; else process.env[key] = values[key];
    }
    try {
        return run();
    } finally {
        for (const key of Object.keys(saved)) {
            if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key];
        }
    }
}

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('production refuses to start without a SESSION_SECRET', () => {
    withEnv({ NODE_ENV: 'production', SESSION_SECRET: undefined }, () => {
        assert.throws(() => createApp(), /SESSION_SECRET/);
    });
});

test('production starts fine when a SESSION_SECRET is set', () => {
    withEnv({ NODE_ENV: 'production', SESSION_SECRET: 'a-long-random-test-secret' }, () => {
        assert.doesNotThrow(() => createApp());
    });
});

test('local development and tests still start without a SESSION_SECRET', () => {
    withEnv({ NODE_ENV: undefined, SESSION_SECRET: undefined }, () => {
        assert.doesNotThrow(() => createApp());
    });
});

test('the systemd unit reads SESSION_SECRET from the root-only env file', () => {
    const unit = read('deploy/black-forest.service');
    assert.match(unit, /^EnvironmentFile=\/etc\/black-forest\.env$/m);
    assert.match(unit, /^Environment=NODE_ENV=production$/m);
    assert.doesNotMatch(unit, /SESSION_SECRET=/, 'the secret itself must never be in the unit file');
});

test('setup-ec2.sh generates the secret on the server and locks the file down', () => {
    const setup = read('deploy/setup-ec2.sh');
    assert.match(setup, /openssl rand -hex 32/);
    assert.match(setup, /ENV_FILE="\/etc\/\$\{APP_NAME\}\.env"/);
    assert.match(setup, /chmod 600 "\$ENV_FILE"/);
    assert.match(setup, /already exists, keeping the existing secret/);
});

test('deploy.sh stops with a clear message when the server was never set up', () => {
    const deploy = read('deploy/deploy.sh');
    assert.match(deploy, /\/etc\/black-forest\.env is missing/);
    assert.match(deploy, /setup-ec2\.sh/);
});

test('the secret file never lands in the repository or the deploy upload', () => {
    assert.match(read('.gitignore'), /^\.env$/m);
    assert.match(read('deploy/deploy.sh'), /--exclude='\.env'/);
});