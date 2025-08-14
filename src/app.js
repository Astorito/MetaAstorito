const express = require('express');
const { connectDB } = require('./config/database');
const { port } = require('./config/environment');
const webhookRoutes = require('./routes/webhook');

const app = express();
app.use(express.json());

connectDB();

app.use('/', webhookRoutes);

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});