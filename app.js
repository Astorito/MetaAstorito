const express = require('express');
const { connectDB } = require('./src/config/database');
const { port } = require('./src/config/environment');
const webhookRoutes = require('./src/routes/webhook');

const app = express();
app.use(express.json());

// Conectar a MongoDB
connectDB();

// Rutas
app.use('/', webhookRoutes);

app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});