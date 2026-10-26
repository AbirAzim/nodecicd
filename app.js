import express from 'express';

const app = express();

app.use(express.json());

const users = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
];
let nextId = 3;

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

app.get('/info', (req, res) => {
    res.json({
        name: 'simple-node',
        uptime: Math.floor(process.uptime()),
        time: new Date().toISOString(),
    });
});

app.get('/users', (req, res) => {
    res.json(users);
});

app.get('/users/:id', (req, res) => {
    const user = users.find((u) => u.id === Number(req.params.id));

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
});

app.post('/users', (req, res) => {
    const { name } = req.body ?? {};

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    const user = { id: nextId++, name };
    users.push(user);

    res.status(201).json(user);
});

app.put('/users/:id', (req, res) => {
    const user = users.find((u) => u.id === Number(req.params.id));

    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }

    const { name } = req.body ?? {};

    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }

    user.name = name;

    res.json(user);
});

app.delete('/users/:id', (req, res) => {
    const index = users.findIndex((u) => u.id === Number(req.params.id));

    if (index === -1) {
        return res.status(404).json({ error: 'User not found' });
    }

    users.splice(index, 1);

    res.status(204).end();
});

export default app;
