import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';

test('GET / returns Hello World with request info', async () => {
    const res = await request(app)
        .get('/')
        .set('User-Agent', 'test-agent')
        .set('Accept-Language', 'en-US');

    assert.equal(res.status, 200);
    assert.equal(res.body.message, 'Hello World');
    assert.ok(res.body.ip);
    assert.equal(res.body.method, 'GET');
    assert.equal(res.body.path, '/');
    assert.equal(res.body.userAgent, 'test-agent');
    assert.equal(res.body.language, 'en-US');
    assert.ok(res.body.time);
});

test('GET /health returns ok', async () => {
    const res = await request(app).get('/health');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: 'ok' });
});

test('GET /users returns the list of users', async () => {
    const res = await request(app).get('/users');

    assert.equal(res.status, 200);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(res.body[0], { id: 1, name: 'Alice' });
});

test('GET /users/:id returns one user', async () => {
    const res = await request(app).get('/users/2');

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 2, name: 'Bob' });
});

test('GET /users/:id returns 404 for a missing user', async () => {
    const res = await request(app).get('/users/999');

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'User not found' });
});

test('POST /users creates a user', async () => {
    const res = await request(app).post('/users').send({ name: 'Charlie' });

    assert.equal(res.status, 201);
    assert.equal(res.body.name, 'Charlie');
    assert.ok(res.body.id);
});

test('POST /users without a name returns 400', async () => {
    const res = await request(app).post('/users').send({});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Name is required' });
});

test('GET /info returns app info', async () => {
    const res = await request(app).get('/info');

    assert.equal(res.status, 200);
    assert.equal(res.body.name, 'simple-node');
    assert.equal(typeof res.body.uptime, 'number');
    assert.ok(res.body.time);
});

test('PUT /users/:id updates a user', async () => {
    const res = await request(app).put('/users/2').send({ name: 'Bobby' });

    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { id: 2, name: 'Bobby' });
});

test('PUT /users/:id returns 404 for a missing user', async () => {
    const res = await request(app).put('/users/999').send({ name: 'Nobody' });

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'User not found' });
});

test('PUT /users/:id without a name returns 400', async () => {
    const res = await request(app).put('/users/1').send({});

    assert.equal(res.status, 400);
    assert.deepEqual(res.body, { error: 'Name is required' });
});

test('DELETE /users/:id removes a user', async () => {
    const created = await request(app).post('/users').send({ name: 'Temp' });
    const id = created.body.id;

    const res = await request(app).delete(`/users/${id}`);
    assert.equal(res.status, 204);

    const check = await request(app).get(`/users/${id}`);
    assert.equal(check.status, 404);
});

test('DELETE /users/:id returns 404 for a missing user', async () => {
    const res = await request(app).delete('/users/999');

    assert.equal(res.status, 404);
    assert.deepEqual(res.body, { error: 'User not found' });
});
