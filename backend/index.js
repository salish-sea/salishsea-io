import express from 'express';
const app = express();
const port = 8172;
app.get('/', (req, res) => {
    res.send('Hello, world!');
});
app.listen(port, () => {
    console.log(`App listening on port ${port}.`);
});
