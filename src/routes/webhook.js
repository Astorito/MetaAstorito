const express = require('express');
const router = express.Router();
const { verifyWebhook } = require('../middleware/auth');
const { handleOnboarding } = require('../middleware/onboarding');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { getGPTResponse, parseReminderWithOpenAI } = require('../services/openai');
const { downloadWhatsAppAudio, transcribeWithWhisper } = require('../services/audio');

router.post("/", async (req, res) => {
  try {
    // Log del webhook completo
    console.log('Webhook recibido:', new Date().toISOString());
    console.log('Body:', JSON.stringify(req.body, null, 2));

    const entry = req.body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;
    const message = messages?.[0];
    const from = message?.from;

    // Log de datos procesados
    console.log('Mensaje procesado:', {
      from,
      messageType: message?.type,
      messageText: message?.text?.body,
      audioId: message?.audio?.id
    });

    if (!message || !from) {
      console.log("No hay mensaje válido o remitente");
      return res.sendStatus(200);
    }

    // Verificar onboarding
    const onboardingResponse = await handleOnboarding(from, message?.text?.body);
    if (onboardingResponse) {
      console.log('Respuesta onboarding:', onboardingResponse);
      await sendWhatsAppMessage(from, onboardingResponse.message);
      if (!onboardingResponse.shouldContinue) {
        return res.sendStatus(200);
      }
    }

    // ... resto del código ...

  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(500);
  }
});

module.exports = router;