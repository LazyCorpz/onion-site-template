import assert from 'node:assert/strict';
import { after, describe, it, type TestContext } from 'node:test';
import mongoose from 'mongoose';
import { connect, isConnected, reconnectOnDisconnect } from '../db/connection';

const URI = 'mongodb://127.0.0.1:27017/test';
const RETRY_MS = 100;

/** Lets a scheduled retry run to completion under mocked timers */
async function drain() {
    await new Promise((resolve) => setImmediate(resolve));
}

after(() => {
    mongoose.connection.removeAllListeners('disconnected');
});

describe('connection', () => {
    it('retries until the database accepts', async (t: TestContext) => {
        t.mock.method(console, 'error', () => undefined);
        t.mock.timers.enable({ apis: ['setTimeout'] });

        let refusals = 2;
        const attempt = t.mock.method(mongoose, 'connect', () => {
            if (refusals > 0) {
                refusals--;

                return Promise.reject(new Error('connection refused'));
            }

            return Promise.resolve(mongoose);
        });

        await connect(URI, RETRY_MS);

        assert.equal(attempt.mock.callCount(), 1);

        for (let i = 0; i < 2; i++) {
            t.mock.timers.tick(RETRY_MS);
            await drain();
        }

        assert.equal(attempt.mock.callCount(), 3);

        t.mock.timers.tick(RETRY_MS);
        await drain();

        assert.equal(attempt.mock.callCount(), 3);
    });

    it('logs the error name but never the connection string', async (t: TestContext) => {
        const logged = t.mock.method(console, 'error', () => undefined);

        t.mock.timers.enable({ apis: ['setTimeout'] });
        t.mock.method(mongoose, 'connect',
            () => Promise.reject(new Error(`failed for ${URI}`)));

        await connect(URI, RETRY_MS);

        const line = String(logged.mock.calls[0].arguments[0]);

        assert.match(line, /Error/);
        assert.doesNotMatch(line, /mongodb:\/\//);
    });

    it('reconnects when the database drops the connection', async (t: TestContext) => {
        t.mock.method(console, 'error', () => undefined);

        const attempt = t.mock.method(mongoose, 'connect',
            () => Promise.resolve(mongoose));

        reconnectOnDisconnect(URI);
        t.after(() => {
            mongoose.connection.removeAllListeners('disconnected');
        });

        mongoose.connection.emit('disconnected');
        await drain();

        assert.equal(attempt.mock.callCount(), 1);
    });

    it('reports the database as unusable while disconnected', () => {
        assert.equal(isConnected(), false);
    });
});
