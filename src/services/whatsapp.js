const axios = require('axios');
const { whatsappToken, phoneNumberId } = require('../config/environment');
const { logOutgoingInteraction } = require('./analytics');

async function sendWhatsAppMessage(to, message, category = "", buttons = null) {
  try {
    console.log('📤 Enviando mensaje a:', to);
    
    let messageData = {
      messaging_product: "whatsapp",
      to: to,
    };

    if (buttons) {
      messageData.type = "interactive";
      messageData.interactive = {
        type: "button",
        body: {
          text: buttons.title
        },
        action: {
          buttons: buttons.buttons.map(button => ({
            type: "reply",
            reply: {
              id: button.toLowerCase(),
              title: button
            }
          }))
        }
      };
    } else {
      messageData.text = { body: message };
    }

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      messageData,
      {
        headers: {
          'Authorization': `Bearer ${whatsappToken}`,
          'Content-Type': 'application/json'
        }
      }
    );

    console.log('✅ Mensaje enviado:', response.data);

    // Registrar la interacción saliente
    await logOutgoingInteraction(to, message, category);
    
    return response.data;
  } catch (err) {
    console.error("❌ Error enviando mensaje:", err);
    throw err;
  }
}

module.exports = { sendWhatsAppMessage };