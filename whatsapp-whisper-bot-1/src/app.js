const express = require('express');
const bodyParser = require('body-parser');
const whatsappController = require('./controllers/whatsappController');

const app = express();
const port = process.env.PORT || 3000;

app.use(bodyParser.json());

// Rutas para manejar mensajes de WhatsApp
app.post('/webhook', whatsappController.handleIncomingMessage);

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});