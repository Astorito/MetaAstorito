const mongoose = require('mongoose');

const userContextSchema = new mongoose.Schema({
  phone: {
    type: String,
    required: true,
    unique: true
  },
  lastService: {
    type: String,
    enum: ['listas', 'clima', 'recordatorio', 'generalquery', 'cumpleaños'],
    default: null
  },
  // Contexto específico para listas
  lastListName: String,
  lastListAction: String,
  
  // Contexto específico para clima
  lastCity: String,
  
  // Contexto específico para recordatorios
  lastReminderTitle: String,
  
  // Timestamp para determinar si el contexto sigue siendo relevante
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('UserContext', userContextSchema);