const axios = require('axios');
const { whatsappToken, phoneNumberId } = require('../config/environment');

async function sendWhatsAppMessage(to, message) {
  try {
    console.log('📤 Enviando mensaje a:', to);
    console.log('📝 Contenido:', message);
    
    if (!whatsappToken || !phoneNumberId) {
      throw new Error('Faltan credenciales de WhatsApp');
    }

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: "whatsapp",
        to,
        text: { body: message }
      },
      {
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json'
        },
        timeout: 5000 // 5 segundos de timeout
      }
    );

    console.log('✅ Mensaje enviado:', response.data);
    return response.data;
  } catch (err) {
    console.error("❌ Error enviando mensaje:", {
      status: err.response?.status,
      error: err.response?.data?.error,
      message: err.message
    });
    throw err;
  }
}

module.exports = { sendWhatsAppMessage };