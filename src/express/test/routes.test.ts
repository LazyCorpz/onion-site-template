import assert from 'node:assert/strict';
import { type Server } from 'node:http';
import { after, before, describe, it, type TestContext } from 'node:test';
import { MsgModel } from '../db/msgBoard';
import { stubAggregate } from './support';

process.env.MONGODB_URI ??= 'mongodb://127.0.0.1:27017/test';

const { default: app } = await import('../app');

let server: Server;
let base: string;

function post(path: string, fields: Record<string, string>) {
    return fetch(base + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(fields),
        redirect: 'manual'
    });
}

before(async () => {
    await new Promise<void>((resolve) => {
        server = app.listen(0, () => {
            resolve();
        });
    });

    const address = server.address();

    if (address === null || typeof address === 'string') {
        throw new Error('expected a TCP address');
    }

    base = `http://127.0.0.1:${address.port.toString()}`;
});

after(async () => {
    await new Promise<void>((resolve, reject) => {
        server.close((err) => {
            if (err) {
                reject(err);
            }
            else {
                resolve();
            }
        });
    });
});

describe('routes', () => {
    it('serves the home page', async () => {
        const res = await fetch(base + '/');

        assert.equal(res.status, 200);
        assert.match(await res.text(), /Home/);
    });

    it('renders an error page for an unknown path', async () => {
        const res = await fetch(base + '/nonexistent');

        assert.equal(res.status, 404);
        assert.match(await res.text(), /Not Found/);
    });

    it('renders stored messages', async (t: TestContext) => {
        stubAggregate(t, [{ _id: 'id', name: 'ann', content: 'hello', lastModified: 0 }]);

        const res = await fetch(base + '/chat');

        assert.equal(res.status, 200);
        assert.match(await res.text(), /hello/);
    });

    it('passes the requested page through to the query', async (t: TestContext) => {
        const aggregate = stubAggregate(t, []);

        await fetch(base + '/chat?page=5');

        const stages = aggregate.mock.calls[0].arguments[0]!;

        assert.deepEqual(stages.at(1), { $skip: 40 });
    });

    it('rejects a message with no content', async (t: TestContext) => {
        const insertOne = t.mock.method(MsgModel, 'insertOne',
            () => Promise.resolve() as unknown as ReturnType<typeof MsgModel.insertOne>);

        const res = await post('/chat/send', { name: 'ann', content: '' });

        assert.equal(res.status, 400);
        assert.equal(insertOne.mock.callCount(), 0);
    });

    it('redirects to the board after accepting a message', async (t: TestContext) => {
        const insertOne = t.mock.method(MsgModel, 'insertOne',
            () => Promise.resolve() as unknown as ReturnType<typeof MsgModel.insertOne>);

        const res = await post('/chat/send', { name: 'ann', content: 'hello' });

        assert.equal(res.status, 302);
        assert.equal(res.headers.get('location'), '/chat');
        assert.equal(insertOne.mock.callCount(), 1);
    });

    it('rejects a delete with a malformed id', async () => {
        const res = await post('/chat/delete', { id: 'not-a-valid-object-id' });

        assert.equal(res.status, 400);
    });

    it('serves 503 when a query fails with no database behind it', async (t: TestContext) => {
        t.mock.method(MsgModel, 'aggregate', () => ({
            exec: () => Promise.reject(new Error('connection refused'))
        }) as unknown as ReturnType<typeof MsgModel.aggregate>);

        const res = await fetch(base + '/chat');
        const body = await res.text();

        assert.equal(res.status, 503);
        assert.doesNotMatch(body, /connection refused/);
    });
});
