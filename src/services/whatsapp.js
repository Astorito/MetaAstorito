const axios = require('axios');
const { whatsappToken, phoneNumberId } = require('../config/environment');

async function sendWhatsAppMessage(to, message) {
  try {
    await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: message }
      },
      {
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json"
        }
      }
    );
  } catch (err) {
    console.error("Error enviando mensaje WhatsApp:", err.response?.data || err.message);
  }
}

module.exports = { sendWhatsAppMessage };