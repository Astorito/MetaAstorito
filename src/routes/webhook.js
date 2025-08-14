const express = require('express');
const router = express.Router();
const { verifyWebhook } = require('../middleware/auth');
const { handleOnboarding } = require('../middleware/onboarding');
const { sendWhatsAppMessage } = require('../services/whatsapp');
const { getGPTResponse, parseReminderWithOpenAI } = require('../services/openai');
const { downloadWhatsAppAudio, transcribeWithWhisper } = require('../services/audio');
const { scheduleReminder } = require('../services/scheduler');

router.post("/", async (req, res) => {
  try {
    const entry = req.body.entry?.[0];
    const message = entry?.changes?.[0]?.value?.messages?.[0];
    const from = message?.from;

    if (!message || !from) {
      return res.sendStatus(200);
    }

    // Manejar audio
    if (message.audio) {
      // ... lógica de audio ...
    }

    // Manejar texto
    const messageText = message?.text?.body;
    if (!messageText) {
      return res.sendStatus(200);
    }

    // Verificar onboarding
    const onboardingResponse = await handleOnboarding(from, messageText);
    if (onboardingResponse) {
      await sendWhatsAppMessage(from, onboardingResponse.message);
      if (!onboardingResponse.shouldContinue) {
        return res.sendStatus(200);
      }
    }

    // ... resto de la lógica del webhook ...

  } catch (err) {
    console.error("Error en webhook:", err);
    return res.sendStatus(500);
  }
});

module.exports = router;