const path = require('path');
const express = require('express');
const { RateLimiter } = require('../src');

const app = express();
const port = Number(process.env.PORT || 3000);

const configPath = path.join(__dirname, 'config', 'rate-limiter.json');

RateLimiter.init({
  configPath,
  cache: { type: 'memory' }
});

app.get('/hello', RateLimiter.apply('my-hello-route'), (req, res) => {
  res.status(200).json({
    message: 'Hello world',
    timestamp: new Date().toISOString(),
  });
});

app.listen(port, () => {
  console.log(`Rate limiter demo server running on http://localhost:${port}`);
  console.log('Try: GET /hello repeatedly to trigger 429');
});
