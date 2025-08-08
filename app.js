// Import Express.js y axios para enviar respuestas
const express = require('express');
const axios = require('axios');

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN; // tu token de acceso de Meta
const phoneNumberId = process.env.PHONE_NUMBER_ID; // ID de tu número de WhatsApp en Cloud API

// Verificación del webhook
app.get('/', (req, res) => {
  const { 'hub.mode': mode, 'hub.challenge': challenge, 'hub.verify_token': token } = req.query;

  if (mode === 'subscribe' && token === verifyToken) {
    console.log('WEBHOOK VERIFIED');
    res.status(200).send(challenge);
  } else {
    res.status(403).end();
  }
});

// Recepción de mensajes y respuesta automática
app.post('/', async (req, res) => {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19);
  console.log(`\n\nWebhook received ${timestamp}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];

    if (message && message.from) {
      const from = message.from; // número del remitente
      console.log(`Responding to: ${from}`);

      // Enviar "Bien, gracias" como respuesta
      await axios.post(
        `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
        {
          messaging_product: 'whatsapp',
          to: from,
          text: { body: 'Bien, gracias' }
        },
        {
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            'Content-Type': 'application/json'
          }
        }
      );
    }
  } catch (err) {
    console.error('Error sending message:', err?.response?.data || err.message);
  }

  res.sendStatus(200);
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`\nListening on port ${port}\n`);
});
