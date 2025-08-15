const axios = require('axios');
const { whatsappToken, phoneNumberId } = require('../config/environment');

async function sendWhatsAppMessage(to, message) {
  try {
    console.log('Enviando mensaje a:', to);
    console.log('Contenido:', message);
    
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
        }
      }
    );

    console.log('Mensaje enviado exitosamente:', response.data);
    return response.data;
  } catch (err) {
    console.error("Error enviando mensaje WhatsApp:", {
      status: err.response?.status,
      data: err.response?.data,
      message: err.message
    });
    throw err;
  }
}

module.exports = { sendWhatsAppMessage };