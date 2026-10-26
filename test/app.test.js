import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import app from '../app.js';

test('GET / returns Hello World', async () => {
    const res = await request(app).get('/');

    assert.equal(res.status, 200);
    assert.equal(res.text, 'Hello World');
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
