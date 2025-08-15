require('dotenv').config();

module.exports = {
  port: process.env.PORT || 3000,
  verifyToken: process.env.VERIFY_TOKEN,
  whatsappToken: process.env.WHATSAPP_TOKEN,
  phoneNumberId: process.env.PHONE_NUMBER_ID,
  openaiToken: process.env.OPENAI_API_KEY,
  model: "gpt-3.5-turbo",
  mongoUri: process.env.MONGODB_URI,
  timezone: 'America/Argentina/Buenos_Aires'
};