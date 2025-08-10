// Importar Express, axios y dotenv
const express = require('express');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(express.json());

// Variables de entorno
const port = process.env.PORT || 3000;
const verifyToken = process.env.VERIFY_TOKEN;
const whatsappToken = process.env.WHATSAPP_TOKEN; // Token Meta
const phoneNumberId = process.env.PHONE_NUMBER_ID; // ID del número de WhatsApp Cloud API
const openaiToken = process.env.OPENAI_API_KEY; // Token de OpenAI

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

// Recepción de mensajes
app.post('/', async (req, res) => {
  console.log(`\n\nWebhook recibido: ${new Date().toISOString()}\n`);
  console.log(JSON.stringify(req.body, null, 2));

  try {
    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const message = changes?.value?.messages?.[0];
    const textMessage = message?.text?.body;

    if (message && message.from && textMessage) {
      const from = message.from; // número remitente
      console.log(`Mensaje de ${from}: ${textMessage}`);

      // 1️⃣ Llamar a GPT-4o para generar respuesta
      const gptResponse = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: "gpt-4o",
          messages: [
            { role: "system", content: "Eres un asistente útil que responde de forma clara y breve." },
            { role: "user", content: textMessage }
          ],
          temperature: 0.3
        },
        {
          headers: {
            "Authorization": `Bearer ${openaiToken}`,
            "Content-Type": "application/json"
          }
        }
      );

      const replyText = gptResponse.data.choices[0].message.content;
      console.log(`Respuesta GPT: ${replyText}`);

      // 2️⃣ Enviar respuesta a WhatsApp
      await axios.post(
        `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
        {
          messaging_product: "whatsapp",
          to: from,
          text: { body: replyText }
        },
        {
          headers: {
            Authorization: `Bearer ${whatsappToken}`,
            "Content-Type": "application/json"
          }
        }
      );
    }
  } catch (err) {
    console.error("Error:", err?.response?.data || err.message);
  }

  res.sendStatus(200);
});

// Iniciar servidor
app.listen(port, () => {
  console.log(`Servidor escuchando en puerto ${port}`);
});
