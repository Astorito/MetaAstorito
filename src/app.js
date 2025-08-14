const express = require('express');
const { connectDB } = require('./config/database');
const { port } = require('./config/environment');
const webhookRoutes = require('./routes/webhook');

const app = express();
app.use(express.json());

// Conectar a MongoDB
connectDB();

// Rutas
app.use('/', webhookRoutes);

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});