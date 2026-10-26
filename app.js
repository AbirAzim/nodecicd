import express from 'express';

const app = express();

app.use(express.json());

const users = [
    { id: 1, name: 'Alice' },
    { id: 2, name: 'Bob' },
];

app.get('/', (req, res) => {
    res.send('Hello World');
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
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

    const user = { id: users.length + 1, name };
    users.push(user);

    res.status(201).json(user);
});

export default app;
